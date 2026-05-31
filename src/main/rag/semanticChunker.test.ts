import { describe, it, expect } from 'vitest'
import { chunkText, chunkSegments } from './semanticChunker.js'
import type { TranscriptSegment } from '../../shared/types.js'

const TARGET = 80
const OVERLAP = 12

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
}

describe('chunkText', () => {
  it('returns no chunks for empty / whitespace-only text', () => {
    expect(chunkText('', 0)).toEqual([])
    expect(chunkText('   \n\t  ', 0)).toEqual([])
  })

  it('packs a short text into a single chunk', () => {
    const chunks = chunkText('hello there friend', 123)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ speaker: null, ts: 123, text: 'hello there friend' })
  })

  it('caps each chunk at TARGET_WORDS', () => {
    const chunks = chunkText(words(200), 0)
    for (const c of chunks) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(TARGET)
    }
  })

  it('overlaps consecutive chunks by OVERLAP_WORDS', () => {
    const chunks = chunkText(words(200), 0)
    expect(chunks.length).toBeGreaterThan(1)
    const first = chunks[0]!.text.split(' ')
    const second = chunks[1]!.text.split(' ')
    // The tail of chunk 0 should reappear at the head of chunk 1.
    const tail = first.slice(first.length - OVERLAP)
    const head = second.slice(0, OVERLAP)
    expect(head).toEqual(tail)
  })

  it('covers every word across the produced chunks', () => {
    const chunks = chunkText(words(170), 0)
    const seen = new Set<string>()
    for (const c of chunks) for (const w of c.text.split(' ')) seen.add(w)
    expect(seen.size).toBe(170)
  })

  it('stamps each chunk with the supplied ts and a null speaker', () => {
    const chunks = chunkText(words(120), 9999)
    expect(chunks.every((c) => c.ts === 9999 && c.speaker === null)).toBe(true)
  })
})

// Sanity check that the transcript path still produces chunks (unchanged
// behavior) so the shared module refactor didn't regress it.
describe('chunkSegments (regression)', () => {
  function seg(text: string, channel: 'mic' | 'system' = 'mic'): TranscriptSegment {
    return {
      id: Math.random().toString(36),
      channel,
      speaker: 0,
      startMs: 0,
      endMs: 1000,
      text,
      isFinal: true,
      createdAt: Date.now()
    }
  }

  it('chunks final segments and labels mic as You', () => {
    const chunks = chunkSegments([seg(words(100))])
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]!.speaker).toBe('You')
  })

  it('ignores non-final segments', () => {
    const s = { ...seg('skip me entirely please'), isFinal: false }
    expect(chunkSegments([s])).toEqual([])
  })
})
