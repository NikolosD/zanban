import { search, type RetrievedChunk } from './vectorStore.js'

const DEFAULT_DISTANCE_THRESHOLD = 1.2 // L2 on normalized 384-dim vectors

export interface RetrievalOptions {
  topK?: number
  distanceThreshold?: number
}

/** A retrieved fragment, surfaced to the renderer's "Sources" affordance. */
export interface RetrievedSource {
  id: number
  kind: 'session' | 'doc' | 'recap'
  /** Doc filename, short session id, or "recap" — already display-ready. */
  label: string
  distance: number
  /** Short preview of the fragment text (full text is large/noisy). */
  snippet: string
}

export interface RetrievalResult {
  /** Prompt-ready block (wrapped in <retrieved_context>), or '' when nothing. */
  prompt: string
  /** Structured fragments for the UI, in similarity order. */
  sources: RetrievedSource[]
}

const SNIPPET_CHARS = 240

function shortLabel(h: RetrievedChunk): string {
  if (h.sourceKind === 'doc') return h.sourceLabel ?? 'document'
  if (h.sourceKind === 'recap') return `recap ${h.sourceId.slice(0, 8)}`
  return `session ${h.sourceId.slice(0, 8)}`
}

function snippet(text: string): string {
  const t = text.trim()
  return t.length > SNIPPET_CHARS ? `${t.slice(0, SNIPPET_CHARS).trimEnd()}…` : t
}

function formatHit(h: RetrievedChunk): string {
  if (h.sourceKind === 'doc') {
    return `[document · ${h.sourceLabel ?? 'untitled'}]\n${h.text}`
  }
  const when = new Date(h.ts).toISOString().slice(0, 10)
  if (h.sourceKind === 'recap') {
    return `[recap · ${when}]\n${h.text}`
  }
  const who = h.speaker ?? '?'
  return `[session ${h.sourceId.slice(0, 8)} · ${when} · ${who}]\n${h.text}`
}

/**
 * Retrieve relevant fragments across ALL sources (transcript history, reference
 * documents, structured recaps) for a user query. Returns a prompt-ready block
 * plus the structured fragments behind it for the renderer's Sources list.
 * Both are empty when no usable results clear the distance threshold.
 */
export async function retrieve(query: string, opts?: RetrievalOptions): Promise<RetrievalResult> {
  const k = opts?.topK ?? 6
  const threshold = opts?.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD
  const hits = await search(query, k)
  const filtered = hits.filter((h) => h.distance <= threshold)
  if (filtered.length === 0) return { prompt: '', sources: [] }

  const lines = filtered.map(formatHit)
  const prompt = `\n\n<retrieved_context>\nRelevant fragments retrieved from previous sessions, your reference documents, and meeting recaps — ordered by similarity. Use only what answers the question; ignore the rest.\n\n${lines.join('\n\n')}\n</retrieved_context>`

  const sources: RetrievedSource[] = filtered.map((h) => ({
    id: h.id,
    kind: h.sourceKind,
    label: shortLabel(h),
    distance: h.distance,
    snippet: snippet(h.text)
  }))

  return { prompt, sources }
}

/**
 * Back-compat string-only wrapper. Some callers only need the prompt block.
 */
export async function retrieveContext(query: string, opts?: RetrievalOptions): Promise<string> {
  return (await retrieve(query, opts)).prompt
}
