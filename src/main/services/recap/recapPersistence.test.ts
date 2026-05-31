import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRecap, writeRecap, deleteRecap, listRecapIds } from './recapPersistence.js'
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

  it('returns null but KEEPS the file when JSON is corrupt (soft-degrade)', async () => {
    const badPath = join(dir, 'bad.recap.json')
    await writeFile(badPath, '{ not json')
    expect(await readRecap(dir, 'bad')).toBeNull()
    // Soft-degrade: the file must survive so the user's data is never destroyed
    // by a transient parse/encoding glitch.
    expect(await readFile(badPath, 'utf8')).toBe('{ not json')
  })

  it('returns null but KEEPS the file when payload fails schema validation', async () => {
    const badPath = join(dir, 'bad2.recap.json')
    const contents = JSON.stringify({ tldr: '' })
    await writeFile(badPath, contents)
    expect(await readRecap(dir, 'bad2')).toBeNull()
    expect(await readFile(badPath, 'utf8')).toBe(contents)
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

  it('listRecapIds returns ids for recap files only', async () => {
    expect(await listRecapIds(dir)).toEqual([])
    await writeRecap(dir, 'sessA', sample)
    await writeRecap(dir, 'sessB', sample)
    // Decoy non-recap files must be ignored.
    await writeFile(join(dir, 'sessA.json'), '{}')
    await writeFile(join(dir, 'notes.txt'), 'x')
    const ids = await listRecapIds(dir)
    expect(ids.sort()).toEqual(['sessA', 'sessB'])
  })

  it('listRecapIds returns [] for a missing directory', async () => {
    expect(await listRecapIds(join(dir, 'does-not-exist'))).toEqual([])
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
