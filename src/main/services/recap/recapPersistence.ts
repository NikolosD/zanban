import { readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { recapSchema, RECAP_SCHEMA_VERSION, type RecapPayload } from './recapSchema.js'

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
    await safeUnlink(path)
    return null
  }

  const result = recapSchema.safeParse(parsedJson)
  if (!result.success) {
    await safeUnlink(path)
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

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
