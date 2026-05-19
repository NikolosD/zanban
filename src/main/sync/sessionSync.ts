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
let buffer: TranscriptSegment[] = []
let timer: NodeJS.Timeout | null = null
let activeSessionId: string | null = null
let initialized = false

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
    buffer.push(seg)
  })

  sessionManager.onSessionEnd((sessionId) => {
    const rec = sessions.get(sessionId)
    if (!rec) return
    void flush().then(() => void finalize(rec))
  })

  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const rec = ensureRecord()
  if (!rec) {
    buffer = []
    return
  }
  const batch = buffer.splice(0, buffer.length).filter((s) => s.isFinal)
  for (const s of batch) {
    rec.segments.push({ channel: s.channel, startMs: s.startMs, text: s.text })
  }
  if (batch.length > 0) {
    await persist(rec)
  }
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
  const title = await generateSessionTitle(titleSegments).catch(() => null)
  if (title) rec.title = title
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
  await persist(rec)
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
