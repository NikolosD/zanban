import type { TranscriptSegment } from '../../shared/types.js'
import { chunkSegments } from './semanticChunker.js'
import { indexChunks } from './vectorStore.js'
import { cleanSegments } from './transcriptCleaner.js'
import { trackJob } from '../services/jobsManager.js'

const FLUSH_AFTER_FINALS = 10
const FLUSH_AFTER_SECONDS = 30

interface SessionBuffer {
  segments: TranscriptSegment[]
  lastFlushAt: number
  finalsSinceFlush: number
}

const buffers = new Map<string, SessionBuffer>()

/**
 * Feed a finalized transcript segment into the live indexer. Chunks accumulate
 * per-session and are flushed (embedded + persisted) every N final segments
 * or every M seconds, whichever comes first. Best-effort — failures are
 * swallowed so a broken indexer doesn't kill the session.
 */
export function pushSegment(sessionId: string, segment: TranscriptSegment): void {
  if (!segment.isFinal || !segment.text.trim()) return
  const buf = buffers.get(sessionId) ?? {
    segments: [],
    lastFlushAt: Date.now(),
    finalsSinceFlush: 0
  }
  buf.segments.push(segment)
  buf.finalsSinceFlush += 1
  buffers.set(sessionId, buf)

  const elapsed = (Date.now() - buf.lastFlushAt) / 1000
  if (buf.finalsSinceFlush >= FLUSH_AFTER_FINALS || elapsed >= FLUSH_AFTER_SECONDS) {
    void flushSession(sessionId)
  }
}

export async function flushSession(sessionId: string): Promise<void> {
  const buf = buffers.get(sessionId)
  if (!buf || buf.segments.length === 0) return
  const segments = buf.segments
  buf.segments = []
  buf.finalsSinceFlush = 0
  buf.lastFlushAt = Date.now()
  try {
    const cleaned = cleanSegments(segments)
    if (cleaned.length === 0) return
    const chunks = chunkSegments(cleaned)
    if (chunks.length > 0) {
      await trackJob(
        `rag-${sessionId}-${Date.now()}`,
        `Indexing ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`,
        'rag',
        () => indexChunks(sessionId, chunks)
      )
    }
  } catch (err) {
    console.error('[rag] flush failed', err)
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all([...buffers.keys()].map(flushSession))
}

export function clearSession(sessionId: string): void {
  buffers.delete(sessionId)
}
