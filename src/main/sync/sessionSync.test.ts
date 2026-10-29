import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SessionState, TranscriptSegment } from '../../shared/types.js'

const fake = vi.hoisted(() => ({
  dir: '',
  state: { kind: 'idle' } as SessionState,
  segmentListeners: [] as Array<(seg: TranscriptSegment, sessionId: string) => void>,
  endListeners: [] as Array<(sessionId: string) => void>,
  openElsewhere: new Set<string>()
}))

vi.mock('electron', () => ({ app: { getPath: () => fake.dir } }))
// Windows refuses to rename over a file that any other handle has open.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (fake.openElsewhere.has(to)) {
        const err = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`)
        throw Object.assign(err, { code: 'EPERM' })
      }
      return fs.rename(from, to)
    }
  }
})
vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: {
    getState: () => fake.state,
    onSegment: (cb: (seg: TranscriptSegment, sessionId: string) => void) => {
      fake.segmentListeners.push(cb)
      return () => {}
    },
    onSessionEnd: (cb: (sessionId: string) => void) => {
      fake.endListeners.push(cb)
      return () => {}
    }
  }
}))
vi.mock('../ai/titleGen.js', () => ({ generateSessionTitle: async () => null }))

const sync = await import('./sessionSync.js')

function final(text: string, sessionId: string): void {
  const seg: TranscriptSegment = {
    id: text,
    channel: 'system',
    speaker: 1,
    startMs: 0,
    endMs: 0,
    text,
    isFinal: true,
    createdAt: 0
  }
  for (const cb of fake.segmentListeners) cb(seg, sessionId)
}

function run(sessionId: string): void {
  fake.state = { kind: 'running', sessionId, startedAt: Date.now() }
}

async function stop(sessionId: string): Promise<void> {
  fake.state = { kind: 'idle' }
  for (const cb of fake.endListeners) cb(sessionId)
  await sync.awaitSessionFinalized(sessionId)
}

/** Runs one periodic flush and waits until every queued write has landed. */
async function flushed(): Promise<void> {
  vi.advanceTimersByTime(4000)
  // Any serialized op queues behind the flush; deleting an unknown id is a no-op.
  await sync.deleteSessionFromDisk('barrier')
}

async function texts(sessionId: string): Promise<string[] | undefined> {
  return (await sync.readSessionFromDisk(sessionId))?.segments.map((s) => s.text)
}

describe('session sync', () => {
  beforeAll(() => {
    fake.dir = mkdtempSync(join(tmpdir(), 'zanban-sync-'))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    sync.registerSyncWindow({} as BrowserWindow)
  })

  afterAll(() => {
    sync.shutdownSync()
    vi.useRealTimers()
    rmSync(fake.dir, { recursive: true, force: true })
  })

  it('files a final that lands after Stop under the stopped session, not the next one', async () => {
    run('a')
    final('hello', 'a')
    await stop('a')
    final('late tail', 'a')
    run('b')
    final('next call', 'b')
    await flushed()

    expect(await texts('a')).toEqual(['hello', 'late tail'])
    expect((await sync.readSessionFromDisk('a'))?.endedAt).not.toBeNull()
    expect(await texts('b')).toEqual(['next call'])
    await stop('b')
  })

  it('drops stragglers for a session deleted in the meantime', async () => {
    run('c')
    final('kept until delete', 'c')
    await stop('c')
    await sync.deleteSessionFromDisk('c')
    final('straggler', 'c')
    await flushed()

    expect(await sync.readSessionFromDisk('c')).toBeNull()
  })

  it('does not save a session that ended without any speech', async () => {
    run('empty')
    await stop('empty')
    await flushed()

    expect(await sync.readSessionFromDisk('empty')).toBeNull()
    expect(readdirSync(join(fake.dir, 'sessions'))).not.toContain('empty.json')
  })

  it('writes through a temp file and leaves no partial files behind', async () => {
    run('d')
    final('one', 'd')
    await flushed()
    final('two', 'd')
    await flushed()
    await stop('d')

    expect(await texts('d')).toEqual(['one', 'two'])
    const files = readdirSync(join(fake.dir, 'sessions'))
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(files).toContain('d.json')
    expect(files).toContain('d.md')
  })

  it('still saves the end of a session while its file is briefly open elsewhere', async () => {
    run('e')
    final('first', 'e')
    await flushed()
    final('last words', 'e')
    // The dashboard re-reads the session the moment it stops.
    const json = join(fake.dir, 'sessions', 'e.json')
    fake.openElsewhere.add(json)
    setTimeout(() => fake.openElsewhere.delete(json), 50)
    await stop('e')

    expect(await texts('e')).toEqual(['first', 'last words'])
    expect((await sync.readSessionFromDisk('e'))?.endedAt).not.toBeNull()
  })
})
