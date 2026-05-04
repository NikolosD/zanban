import { search, type RetrievedChunk } from './vectorStore.js'

const DEFAULT_DISTANCE_THRESHOLD = 1.2 // L2 on normalized 384-dim vectors

export interface RetrievalOptions {
  topK?: number
  distanceThreshold?: number
}

/**
 * Retrieve relevant transcript snippets across ALL sessions for a user query.
 * Returns a prompt-ready string block, or an empty string when no usable
 * results are found.
 */
export async function retrieveContext(query: string, opts?: RetrievalOptions): Promise<string> {
  const k = opts?.topK ?? 6
  const threshold = opts?.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD
  const hits = await search(query, k)
  const filtered = hits.filter((h) => h.distance <= threshold)
  if (filtered.length === 0) return ''
  const lines = filtered.map(formatHit)
  return `\n\n<retrieved_history>\nRelevant snippets from previous sessions, ordered by similarity. Use only if they answer the question — ignore otherwise.\n\n${lines.join('\n\n')}\n</retrieved_history>`
}

function formatHit(h: RetrievedChunk): string {
  const when = new Date(h.ts).toISOString().slice(0, 10)
  const who = h.speaker ?? '?'
  return `[session ${h.sessionId.slice(0, 8)} · ${when} · ${who}]\n${h.text}`
}
