import { chunkText } from './semanticChunker.js'
import { deleteRecap, indexRecapChunks } from './vectorStore.js'
import { trackJob } from '../services/jobsManager.js'

/** Minimal shape of the recap fields we index — keeps this decoupled from the
 *  full RecapPayload so it can be fed a plain object. */
export interface IndexableRecap {
  tldr: string
  decisions: string[]
  actionItems: Array<{ text: string; owner: string; dueHint?: string }>
  openQuestions: string[]
}

/**
 * Flatten the structured recap into a single retrievable text block. Action
 * items and decisions are the highest-value bits for "what did we agree on?"
 * style follow-up questions, so they're spelled out plainly. Pure + exported
 * for unit testing.
 */
export function recapToText(recap: IndexableRecap): string {
  const parts: string[] = []
  if (recap.tldr.trim()) parts.push(`Summary: ${recap.tldr.trim()}`)
  if (recap.decisions.length > 0) {
    parts.push(`Decisions: ${recap.decisions.join('; ')}`)
  }
  if (recap.actionItems.length > 0) {
    parts.push(
      `Action items: ${recap.actionItems
        .map((a) => {
          const owner = a.owner === 'you' ? 'You' : a.owner === 'them' ? 'Them' : 'Someone'
          return `${owner} — ${a.text}${a.dueHint ? ` (${a.dueHint})` : ''}`
        })
        .join('; ')}`
    )
  }
  if (recap.openQuestions.length > 0) {
    parts.push(`Open questions: ${recap.openQuestions.join('; ')}`)
  }
  return parts.join('\n')
}

async function meetingStartedAt(sessionId: string): Promise<number> {
  // Imported lazily: sessionSync → sessionManager → rag/index would cycle back here.
  const { readSessionFromDisk } = await import('../sync/sessionSync.js')
  return (await readSessionFromDisk(sessionId))?.startedAt ?? Date.now()
}

/**
 * (Re)index a session's structured recap, replacing any prior recap chunks so a
 * regenerated recap doesn't duplicate the old one. Chunks carry the meeting's
 * date (not the recap's generation time) so they're labeled by when it
 * happened. Best-effort.
 */
export async function indexRecap(
  sessionId: string,
  recap: IndexableRecap,
  meetingAt?: number
): Promise<number> {
  const text = recapToText(recap)
  const chunks = text.trim()
    ? chunkText(text, meetingAt ?? (await meetingStartedAt(sessionId)))
    : []
  if (chunks.length === 0) {
    await deleteRecap(sessionId)
    return 0
  }
  return trackJob(`rag-recap-${sessionId}-${Date.now()}`, 'Indexing recap', 'rag', () =>
    indexRecapChunks(sessionId, chunks)
  )
}
