import { search, type RetrievedChunk } from './vectorStore.js'

// L2 on unit vectors (cosine ≈ 0.33), calibrated on the multilingual encoder:
// relevant RU/EN query–chunk pairs measured ≤ 1.14, the best hit for an
// off-topic question ≥ 1.18.
export const DEFAULT_DISTANCE_THRESHOLD = 1.16
// A hit this much farther than the best one is noise next to it; in the eval the
// expected fragment trailed the best hit by at most 0.091.
const RELATIVE_CUTOFF = 0.12
// Fragments run ~80 words, so this is about five; past that they bury the one
// that answers and cost prompt latency.
const MAX_INJECTED_WORDS = 400
const DUPLICATE_JACCARD = 0.85

export interface RetrievalOptions {
  topK?: number
  distanceThreshold?: number
  /** The live call. Its older chunks are labeled as such rather than as a past meeting. */
  currentSessionId?: string
  /**
   * Epoch ms where the prompt's transcript window starts. Live-call chunks from
   * here on are already in the prompt verbatim and are skipped.
   */
  transcriptWindowStart?: number
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
  /** Structured fragments for the UI, in similarity order — source i is fragment [i + 1]. */
  sources: RetrievedSource[]
}

const SNIPPET_CHARS = 240
const CURRENT_CALL_LABEL = 'earlier in this call'

const NO_MATCH_BLOCK =
  '\n\n<retrieved_context>\nNo matching past sessions or documents.\n</retrieved_context>'

const NOT_SEARCHED_BLOCK =
  "\n\n<retrieved_context>\nPast sessions and documents weren't searched in time, so they may hold an answer that is not shown here.\n</retrieved_context>"

const EN_HISTORY =
  /\b(last time|last (meeting|call|session|week)|(previous|past|earlier) (meetings?|calls?|sessions?|conversations?)|we (discussed|agreed|decided|talked about)|did (we|i|you|they|he|she) (say|mention|agree|decide|discuss|promise)|what did (we|i|you|they|he|she)|recap|meeting notes|(my|the|this|that|our|their) (document|doc|file|resume|cv|contract|spec|presentation|deck)|according to|remind me)\b/i
const RU_HISTORY =
  /(?<![\p{L}\p{N}])(в прошлый раз|прошл\p{L}* (встреч|созвон|разговор|недел)|на встрече|ранее|раньше|обсуждали|договорил|договаривал|решили|что (я|мы|он|она|они|ты|вы) (говорил|сказал|обещал|упоминал)|документ|файл|резюме|договор|презентаци|протокол|напомни)/iu

/** Whether a question refers to past meetings or the user's documents. */
export function looksLikeHistoryQuestion(query: string): boolean {
  return EN_HISTORY.test(query) || RU_HISTORY.test(query)
}

/**
 * The result for a search that outlasted its time budget: nothing, except that
 * a question about past meetings or documents is told they went unsearched, so
 * the model doesn't claim there is nothing in them.
 */
export function retrievalTimedOut(query: string): RetrievalResult {
  return { prompt: looksLikeHistoryQuestion(query) ? NOT_SEARCHED_BLOCK : '', sources: [] }
}

function shortLabel(h: RetrievedChunk, currentSessionId?: string): string {
  if (h.sourceKind === 'doc') return h.sourceLabel ?? 'document'
  if (h.sourceKind === 'recap') return `recap ${h.sourceId.slice(0, 8)}`
  if (h.sourceId === currentSessionId) return CURRENT_CALL_LABEL
  return `session ${h.sourceId.slice(0, 8)}`
}

function snippet(text: string): string {
  const t = text.trim()
  return t.length > SNIPPET_CHARS ? `${t.slice(0, SNIPPET_CHARS).trimEnd()}…` : t
}

// A fragment containing the closing tag could end the block early and have
// the rest of its text read as if it were outside the reference data.
function escapeBlockEnd(text: string): string {
  return text.replace(/<\s*\/\s*retrieved_context\s*>/gi, '&lt;/retrieved_context&gt;')
}

function hitHeader(h: RetrievedChunk, currentSessionId?: string): string {
  if (h.sourceKind === 'doc') return `document · ${h.sourceLabel ?? 'untitled'}`
  if (h.sourceKind === 'session' && h.sourceId === currentSessionId) return CURRENT_CALL_LABEL
  const when = new Date(h.ts).toISOString().slice(0, 10)
  return h.sourceKind === 'recap' ? `meeting recap · ${when}` : `past meeting · ${when}`
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  const union = a.size + b.size - shared
  return union > 0 && shared / union >= DUPLICATE_JACCARD
}

function inTranscriptWindow(h: RetrievedChunk, opts?: RetrievalOptions): boolean {
  return (
    h.sourceKind === 'session' &&
    h.sourceId === opts?.currentSessionId &&
    opts.transcriptWindowStart !== undefined &&
    h.ts >= opts.transcriptWindowStart
  )
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * `hits` arrive ordered by distance, closest first, and stay in that order. The
 * hit that would take the total past the word budget ends the list rather than
 * making room for a smaller, farther one; the closest hit is always kept.
 */
export function selectHits(
  hits: RetrievedChunk[],
  k: number,
  threshold: number,
  opts?: RetrievalOptions
): RetrievedChunk[] {
  const eligible = hits.filter((h) => h.distance <= threshold && !inTranscriptWindow(h, opts))
  const cutoff = (eligible[0]?.distance ?? 0) + RELATIVE_CUTOFF
  const kept: Array<{ hit: RetrievedChunk; words: Set<string> }> = []
  let injectedWords = 0
  for (const hit of eligible) {
    if (kept.length === k || hit.distance > cutoff) break
    const words = wordSet(hit.text)
    if (kept.some((o) => nearDuplicate(o.words, words))) continue
    const size = wordCount(hit.text)
    if (kept.length > 0 && injectedWords + size > MAX_INJECTED_WORDS) break
    kept.push({ hit, words })
    injectedWords += size
  }
  return kept.map((o) => o.hit)
}

/**
 * Retrieve relevant fragments across ALL sources (transcript history, reference
 * documents, structured recaps) for a user query. Returns a prompt-ready block
 * of numbered fragments plus the structured fragments behind it for the
 * renderer's Sources list. When nothing clears the thresholds, both are empty —
 * except for a question about past meetings or documents, which gets an
 * explicit "no match" block so the model doesn't guess.
 */
export async function retrieve(query: string, opts?: RetrievalOptions): Promise<RetrievalResult> {
  const k = opts?.topK ?? 6
  // Persona thresholds were saved on the previous model's distance scale (the
  // settings UI writes 1.2), so a per-call value may only tighten the default.
  const threshold = Math.min(
    opts?.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD,
    DEFAULT_DISTANCE_THRESHOLD
  )
  // Over-fetch: the window and duplicate filters can discard several hits.
  const hits = selectHits(await search(query, k * 3), k, threshold, opts)
  if (hits.length === 0) {
    return { prompt: looksLikeHistoryQuestion(query) ? NO_MATCH_BLOCK : '', sources: [] }
  }

  const current = opts?.currentSessionId
  const lines = hits.map((h, i) => `[${i + 1}] ${hitHeader(h, current)}\n${escapeBlockEnd(h.text)}`)
  const prompt = `\n\n<retrieved_context>\nRelevant fragments retrieved from previous sessions, your reference documents, and meeting recaps — numbered and ordered by similarity. Use only what answers the question; ignore the rest.\n\n${lines.join('\n\n')}\n</retrieved_context>`

  const sources: RetrievedSource[] = hits.map((h) => ({
    id: h.id,
    kind: h.sourceKind,
    label: shortLabel(h, current),
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
