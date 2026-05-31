import type { TranscriptSegment } from '../../shared/types.js'

export interface Chunk {
  speaker: string | null
  ts: number
  text: string
}

const TARGET_WORDS = 80
const OVERLAP_WORDS = 12

/**
 * Pack a stream of transcript segments into chunks of ~TARGET_WORDS each,
 * with a small tail overlap so semantic boundaries aren't lost. Speakers are
 * recorded but a single chunk can span multiple speakers — we anchor to the
 * majority speaker (good enough for retrieval).
 */
export function chunkSegments(segs: TranscriptSegment[]): Chunk[] {
  const chunks: Chunk[] = []
  let words: Array<{ word: string; speaker: string; ts: number }> = []
  for (const s of segs) {
    if (!s.isFinal) continue
    const spk = s.channel === 'mic' ? 'You' : 'Them'
    for (const w of s.text.split(/\s+/).filter(Boolean)) {
      words.push({ word: w, speaker: spk, ts: s.startMs })
    }
    while (words.length >= TARGET_WORDS) {
      const slice = words.slice(0, TARGET_WORDS)
      chunks.push(packChunk(slice))
      // Keep tail as overlap for the next chunk so cross-boundary context is
      // not lost. With 80-word target and 12-word overlap we get ~15% repeat,
      // which is what most RAG cookbook recipes recommend.
      words = words.slice(TARGET_WORDS - OVERLAP_WORDS)
    }
  }
  if (words.length > 0) chunks.push(packChunk(words))
  return chunks
}

/**
 * Pack a block of plain text (reference document, recap, etc.) into ~TARGET_WORDS
 * chunks with the same tail overlap the transcript path uses. Paragraph breaks
 * are softened to spaces — we chunk purely by word budget, which is good enough
 * for retrieval and keeps the logic shared/testable. `speaker` is null and `ts`
 * is the caller-supplied timestamp (e.g. the doc's addedAt) so chunks sort and
 * format consistently with transcript chunks.
 */
export function chunkText(text: string, ts: number): Chunk[] {
  const allWords = text.split(/\s+/).filter(Boolean)
  if (allWords.length === 0) return []
  const chunks: Chunk[] = []
  let i = 0
  while (i < allWords.length) {
    const slice = allWords.slice(i, i + TARGET_WORDS)
    chunks.push({ speaker: null, ts, text: slice.join(' ') })
    if (i + TARGET_WORDS >= allWords.length) break
    i += TARGET_WORDS - OVERLAP_WORDS
  }
  return chunks
}

function packChunk(slice: Array<{ word: string; speaker: string; ts: number }>): Chunk {
  const text = slice.map((w) => w.word).join(' ')
  const ts = slice[0]?.ts ?? 0
  // Majority speaker — count occurrences; ties resolved by first-seen.
  const counts = new Map<string, number>()
  for (const w of slice) counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1)
  let majority: string | null = null
  let max = -1
  for (const [k, v] of counts) {
    if (v > max) {
      max = v
      majority = k
    }
  }
  return { speaker: majority, ts, text }
}
