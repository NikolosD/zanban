import { app, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile, unlink, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sessionManager } from '../transcription/sessionManager.js'
import { generateSessionTitle } from '../ai/titleGen.js'
import type { TranscriptSegment } from '../../shared/types.js'
import type {
  SessionDetailPayload,
  SessionListItem,
  StoredExchange,
  StoredSegment
} from '../../shared/api.js'

const FLUSH_INTERVAL_MS = 4000

interface SessionRecord {
  id: string
  startedAt: number
  endedAt: number | null
  title: string | null
  segments: StoredSegment[]
  exchanges: StoredExchange[]
}

const sessions = new Map<string, SessionRecord>()
const finalizedWaiters = new Map<string, Promise<void>>()
const buffer: TranscriptSegment[] = []
let timer: NodeJS.Timeout | null = null
let activeSessionId: string | null = null
let initialized = false

// Serialize all persistence so the periodic flush and the session-end finalize
// never write the same files concurrently (last-writer-wins used to clobber the
// final tail). Every mutation that persists goes through `serialize`.
let writeChain: Promise<void> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function awaitSessionFinalized(sessionId: string): Promise<void> {
  return finalizedWaiters.get(sessionId) ?? Promise.resolve()
}

function sessionsDir(): string {
  return join(app.getPath('userData'), 'sessions')
}

async function ensureDir(): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true })
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id)
}

function assertSessionId(id: string): void {
  if (!isValidSessionId(id)) throw new Error('invalid session id')
}

function mdPath(id: string): string {
  assertSessionId(id)
  return join(sessionsDir(), `${id}.md`)
}

function jsonPath(id: string): string {
  assertSessionId(id)
  return join(sessionsDir(), `${id}.json`)
}

function ensureRecord(): SessionRecord | null {
  const state = sessionManager.getState()
  if (state.kind !== 'running') {
    activeSessionId = null
    return null
  }
  if (activeSessionId !== state.sessionId) {
    activeSessionId = state.sessionId
    if (!sessions.has(state.sessionId)) {
      // Cold path: a session id we haven't seen this process. Try to hydrate
      // it from disk so a resumed session keeps appending to the same file
      // instead of overwriting it. Falls through to a fresh record if the
      // file isn't there or is unreadable.
      const existing = tryLoadRecord(state.sessionId)
      sessions.set(
        state.sessionId,
        existing ?? {
          id: state.sessionId,
          startedAt: state.startedAt,
          endedAt: null,
          title: null,
          segments: [],
          exchanges: []
        }
      )
    } else {
      // In-memory record exists — clear endedAt so it counts as live again.
      const rec = sessions.get(state.sessionId)
      if (rec) rec.endedAt = null
    }
  }
  return sessions.get(state.sessionId) ?? null
}

/**
 * Resolve a record by id without depending on the live manager state. Used by
 * the session-end handler, which runs after the manager has already flipped to
 * 'idle' (so `ensureRecord()` would bail and lose the buffered tail).
 */
function getOrCreateRecord(sessionId: string, startedAt: number): SessionRecord {
  let rec = sessions.get(sessionId)
  if (!rec) {
    const existing = tryLoadRecord(sessionId)
    rec = existing ?? {
      id: sessionId,
      startedAt,
      endedAt: null,
      title: null,
      segments: [],
      exchanges: []
    }
    sessions.set(sessionId, rec)
  }
  return rec
}

/** Move all buffered final segments into `rec`. Returns true if any were added. */
function drainFinalsInto(rec: SessionRecord): boolean {
  if (buffer.length === 0) return false
  const batch = buffer.splice(0, buffer.length).filter((s) => s.isFinal)
  for (const s of batch) {
    rec.segments.push({ channel: s.channel, startMs: s.startMs, text: s.text })
  }
  return batch.length > 0
}

function tryLoadRecord(id: string): SessionRecord | null {
  try {
    // Synchronous read because ensureRecord runs on the hot per-segment
    // flush path. fs/promises.readFile would force the caller to async and
    // could re-order writes.
    const raw = readFileSync(jsonPath(id), 'utf8')
    const rec = JSON.parse(raw) as SessionRecord
    rec.endedAt = null
    return rec
  } catch {
    return null
  }
}

export function registerSyncWindow(_win: BrowserWindow): void {
  if (initialized) return
  initialized = true

  sessionManager.onSegment((seg) => {
    // Only finals are persisted (flush filters isFinal anyway). Buffering finals
    // only keeps the buffer bounded and lets the session-end handler drain it
    // even after the manager state has already flipped to 'idle'.
    if (seg.isFinal) buffer.push(seg)
  })

  sessionManager.onSessionEnd((sessionId) => {
    // Resolve the record by id (manager state is 'idle' by now) and drain the
    // 0–4s tail of finals still in the buffer since the last interval flush.
    const work = serialize(async () => {
      const rec = getOrCreateRecord(sessionId, Date.now())
      drainFinalsInto(rec)
      await finalize(rec)
    })
    const tracked = work.finally(() => finalizedWaiters.delete(sessionId))
    finalizedWaiters.set(sessionId, tracked)
    void tracked
  })

  timer = setInterval(() => void serialize(flush), FLUSH_INTERVAL_MS)
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const rec = ensureRecord()
  if (!rec) {
    // Not running (stopping/idle). Do NOT clear the buffer — the session-end
    // handler drains these tail segments into the correct record. Clearing here
    // was silently dropping the last few seconds of finals on every Stop.
    return
  }
  const changed = drainFinalsInto(rec)
  if (changed) await persist(rec)
}

async function finalize(rec: SessionRecord): Promise<void> {
  rec.endedAt = Date.now()
  const titleSegments: TranscriptSegment[] = rec.segments.map((s, i) => ({
    id: String(i),
    channel: s.channel,
    speaker: 0,
    startMs: s.startMs,
    endMs: s.startMs,
    text: s.text,
    isFinal: true,
    createdAt: rec.startedAt + s.startMs
  }))
  // Only set a title if there isn't one yet — protects a user rename and avoids
  // clobbering a good title with a fresh generation on resume+stop.
  if (!rec.title) {
    const title = await generateSessionTitle(titleSegments).catch(() => null)
    if (title) rec.title = title
  }
  await persist(rec)
}

export async function recordAiExchange(
  prompt: string,
  answer: string,
  model: string
): Promise<void> {
  const rec = ensureRecord()
  if (!rec) return
  rec.exchanges.push({ prompt, answer, model, createdAt: Date.now() })
  await serialize(() => persist(rec))
}

async function persist(rec: SessionRecord): Promise<void> {
  await ensureDir()
  await Promise.all([
    writeFile(jsonPath(rec.id), JSON.stringify(rec, null, 2), 'utf8'),
    writeFile(mdPath(rec.id), renderMarkdown(rec), 'utf8')
  ])
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function renderMarkdown(rec: SessionRecord): string {
  const startedIso = new Date(rec.startedAt).toISOString()
  const endedIso = rec.endedAt ? new Date(rec.endedAt).toISOString() : ''
  const durationMs = rec.endedAt ? rec.endedAt - rec.startedAt : 0
  const lines: string[] = []
  lines.push('---')
  lines.push(`id: ${rec.id}`)
  lines.push(`startedAt: ${startedIso}`)
  if (endedIso) lines.push(`endedAt: ${endedIso}`)
  if (durationMs) lines.push(`durationMs: ${durationMs}`)
  if (rec.title) lines.push(`title: ${JSON.stringify(rec.title)}`)
  lines.push('---', '')
  lines.push(`# ${rec.title ?? new Date(rec.startedAt).toLocaleString()}`, '')
  lines.push('## Transcript', '')
  if (rec.segments.length === 0) {
    lines.push('_(empty)_', '')
  } else {
    for (const s of rec.segments) {
      const who = s.channel === 'mic' ? 'You' : 'Them'
      lines.push(`- \`${formatMs(s.startMs)}\` **${who}** — ${s.text}`)
    }
    lines.push('')
  }
  if (rec.exchanges.length > 0) {
    lines.push('## AI exchanges', '')
    for (const ex of rec.exchanges) {
      lines.push(`### ${new Date(ex.createdAt).toLocaleString()}`)
      lines.push('')
      lines.push(`**Q:** ${ex.prompt}`, '')
      lines.push(`**A** _(${ex.model ?? 'model'})_`, '')
      lines.push(ex.answer, '')
    }
  }
  return lines.join('\n')
}

export async function listSessionsFromDisk(): Promise<SessionListItem[]> {
  await ensureDir()
  let entries: string[]
  try {
    entries = await readdir(sessionsDir())
  } catch {
    return []
  }
  const items: SessionListItem[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(sessionsDir(), name), 'utf8')
      const rec = JSON.parse(raw) as SessionRecord
      items.push({
        id: rec.id,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        title: rec.title,
        durationMs: rec.endedAt ? rec.endedAt - rec.startedAt : null
      })
    } catch {
      /* skip corrupt files */
    }
  }
  items.sort((a, b) => b.startedAt - a.startedAt)
  return items.slice(0, 200)
}

export async function readSessionFromDisk(id: string): Promise<SessionDetailPayload | null> {
  if (!isValidSessionId(id)) return null
  await ensureDir()
  try {
    const raw = await readFile(jsonPath(id), 'utf8')
    const rec = JSON.parse(raw) as SessionRecord
    return {
      id: rec.id,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      title: rec.title,
      segments: rec.segments,
      exchanges: rec.exchanges,
      filePath: mdPath(id)
    }
  } catch {
    return null
  }
}

export function getSessionsDir(): string {
  return sessionsDir()
}

export function getSessionMdPath(id: string): string {
  return mdPath(id)
}

export async function deleteSessionFromDisk(id: string): Promise<{ ok: boolean }> {
  if (!isValidSessionId(id)) return { ok: false }
  await ensureDir()
  // Refuse if this is the live session — caller must stop it first.
  if (activeSessionId === id) {
    return { ok: false }
  }
  sessions.delete(id)
  let removedAny = false
  for (const p of [jsonPath(id), mdPath(id)]) {
    try {
      await unlink(p)
      removedAny = true
    } catch {
      /* file may not exist — ignore */
    }
  }
  return { ok: removedAny }
}

export async function copySessionMarkdown(id: string, dest: string): Promise<void> {
  if (!isValidSessionId(id)) throw new Error('invalid session id')
  await copyFile(mdPath(id), dest)
}

export function shutdownSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}
