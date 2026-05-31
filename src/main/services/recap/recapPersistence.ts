import { readdir, readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { recapSchema, RECAP_SCHEMA_VERSION, type RecapPayload } from './recapSchema.js'

const RECAP_SUFFIX = '.recap.json'
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function assertId(id: string): void {
  if (!SESSION_ID_RE.test(id)) throw new Error('invalid session id')
}

function recapPath(dir: string, id: string): string {
  return join(dir, `${id}.recap.json`)
}

export async function writeRecap(dir: string, id: string, payload: RecapPayload): Promise<void> {
  assertId(id)
  const tmp = recapPath(dir, id) + '.tmp'
  const final = recapPath(dir, id)
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, final)
}

export async function readRecap(dir: string, id: string): Promise<RecapPayload | null> {
  assertId(id)
  const path = recapPath(dir, id)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    // Soft-degrade: a malformed file means the UI shows the empty state, but we
    // never destroy it — the bytes may still be recoverable by hand, and a
    // transient read/encoding glitch must not delete user data.
    console.warn('[recap] could not parse recap json; keeping file', path)
    return null
  }

  const result = recapSchema.safeParse(parsedJson)
  if (!result.success) {
    // Soft-degrade as above: keep the file, just report no usable recap.
    console.warn('[recap] recap failed schema validation; keeping file', path)
    return null
  }
  const meta = parsedJson as Record<string, unknown>
  return {
    ...result.data,
    schemaVersion: RECAP_SCHEMA_VERSION,
    generatedAt: typeof meta.generatedAt === 'number' ? meta.generatedAt : Date.now(),
    model: typeof meta.model === 'string' ? meta.model : 'unknown',
    promptVersion: typeof meta.promptVersion === 'number' ? meta.promptVersion : 0,
    partial: meta.partial === true ? true : undefined
  }
}

export async function deleteRecap(dir: string, id: string): Promise<void> {
  assertId(id)
  await safeUnlink(recapPath(dir, id))
}

/**
 * Session ids that have a recap sidecar in `dir`. Derived from `<id>.recap.json`
 * filenames; ids that don't match the safe pattern are skipped. Used by the
 * global Action Items aggregation so it doesn't have to scan every session.
 */
export async function listRecapIds(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const ids: string[] = []
  for (const name of entries) {
    if (!name.endsWith(RECAP_SUFFIX)) continue
    const id = name.slice(0, -RECAP_SUFFIX.length)
    if (SESSION_ID_RE.test(id)) ids.push(id)
  }
  return ids
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
