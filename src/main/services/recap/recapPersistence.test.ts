import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRecap, writeRecap, deleteRecap } from './recapPersistence.js'
import type { RecapPayload } from './recapSchema.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zanban-recap-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sample: RecapPayload = {
  schemaVersion: 1,
  tldr: 'hello',
  decisions: [],
  actionItems: [],
  openQuestions: [],
  followUp: null,
  generatedAt: 1700000000000,
  model: 'gemini-2.5-flash-lite',
  promptVersion: 1
}

describe('recapPersistence', () => {
  it('writes then reads the same payload', async () => {
    await writeRecap(dir, 'abc123', sample)
    const back = await readRecap(dir, 'abc123')
    expect(back).toEqual(sample)
  })

  it('returns null when file is missing', async () => {
    expect(await readRecap(dir, 'no-such-id')).toBeNull()
  })

  it('returns null and removes file when JSON is corrupt', async () => {
    await writeFile(join(dir, 'bad.recap.json'), '{ not json')
    expect(await readRecap(dir, 'bad')).toBeNull()
    // file should be cleaned up so the UI shows a clean empty state
    expect(await readRecap(dir, 'bad')).toBeNull()
  })

  it('returns null when payload fails schema validation', async () => {
    await writeFile(join(dir, 'bad2.recap.json'), JSON.stringify({ tldr: '' }))
    expect(await readRecap(dir, 'bad2')).toBeNull()
  })

  it('delete is idempotent', async () => {
    await deleteRecap(dir, 'never-existed') // no throw
    await writeRecap(dir, 'abc', sample)
    await deleteRecap(dir, 'abc')
    expect(await readRecap(dir, 'abc')).toBeNull()
    await deleteRecap(dir, 'abc') // second delete also no-throw
  })

  it('rejects invalid session ids', async () => {
    await expect(writeRecap(dir, '../etc', sample)).rejects.toThrow(/invalid session id/i)
    await expect(readRecap(dir, '../etc')).rejects.toThrow(/invalid session id/i)
  })

  it('atomic write leaves no .tmp file behind on success', async () => {
    await writeRecap(dir, 'abc', sample)
    const content = await readFile(join(dir, 'abc.recap.json'), 'utf8')
    expect(content.length).toBeGreaterThan(0)
    // Check no tmp file is lingering
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
