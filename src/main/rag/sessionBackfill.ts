import { setTimeout as sleep } from 'node:timers/promises'
import type { TranscriptSegment } from '../../shared/types.js'
import { clearBackfillPending } from './db.js'
import { getLocalEmbedder } from './embeddingProvider.js'
import { indexRecap } from './recapIndexer.js'
import { chunkSegments } from './semanticChunker.js'
import { cleanSegments } from './transcriptCleaner.js'
import { hasSource, indexChunks } from './vectorStore.js'
import { trackJob } from '../services/jobsManager.js'

const PAUSE_BETWEEN_SESSIONS_MS = 500

let running: Promise<void> | null = null

/**
 * Re-index past session transcripts and recaps from disk after the vector store
 * started out empty (a rebuild drops every chunk; documents are reconciled
 * separately). One session at a time with a pause in between, so live
 * transcription and answer-time retrieval keep the CPU. Sessions that already
 * have chunks — a backfill cut short by quit, or calls recorded since the
 * rebuild — are skipped, so a rerun only does the remaining work.
 */
export function backfillSessions(): Promise<void> {
  running ??= trackJob('rag-backfill', 'Re-indexing past meetings', 'rag', runBackfill).finally(
    () => {
      running = null
    }
  )
  return running
}

async function runBackfill(): Promise<void> {
  // Imported lazily: sessionSync → sessionManager → rag/index would cycle back here.
  const { listSessionsFromDisk, readSessionFromDisk, getSessionsDir } =
    await import('../sync/sessionSync.js')
  const sessions = await listSessionsFromDisk()
  // A fresh install has nothing to re-index, and loading the embedder would
  // download it for nothing.
  if (sessions.length === 0) {
    await clearBackfillPending()
    return
  }
  // Without an embedder nothing would be indexed; the pending flag stays set so
  // the next launch retries.
  if (!(await getLocalEmbedder())) return
  const { readRecap } = await import('../services/recap/recapPersistence.js')
  const { sessionManager } = await import('../transcription/sessionManager.js')

  let failed = 0
  for (const item of sessions) {
    const live = sessionManager.getState()
    // The live indexer owns the running call's chunks.
    if (live.kind === 'running' && live.sessionId === item.id) continue
    try {
      const session = await readSessionFromDisk(item.id)
      if (!session) continue
      if (!(await hasSource('session', session.id))) {
        const segments: TranscriptSegment[] = session.segments.map((s, i) => ({
          id: String(i),
          channel: s.channel,
          speaker: 0,
          startMs: s.startMs,
          endMs: s.startMs,
          text: s.text,
          isFinal: true,
          createdAt: session.startedAt + s.startMs
        }))
        await indexChunks(session.id, chunkSegments(cleanSegments(segments)))
      }
      if (!(await hasSource('recap', session.id))) {
        const recap = await readRecap(getSessionsDir(), session.id)
        if (recap) await indexRecap(session.id, recap, session.startedAt)
      }
    } catch (err) {
      failed++
      console.warn('[rag] backfill failed for session', item.id, err)
    }
    await sleep(PAUSE_BETWEEN_SESSIONS_MS)
  }
  if (failed === 0) await clearBackfillPending()
}
