import { describe, it, expect } from 'vitest'
import { normalizeFinishReason } from './finishReason.js'

describe('normalizeFinishReason', () => {
  it('maps length / token-cap reasons to "length"', () => {
    expect(normalizeFinishReason('length')).toBe('length')
    expect(normalizeFinishReason('max_tokens')).toBe('length')
    expect(normalizeFinishReason('MAX_TOKENS')).toBe('length')
  })

  it('maps natural completion reasons to "stop"', () => {
    expect(normalizeFinishReason('stop')).toBe('stop')
    expect(normalizeFinishReason('STOP')).toBe('stop')
    expect(normalizeFinishReason('end_turn')).toBe('stop')
    expect(normalizeFinishReason('stop_sequence')).toBe('stop')
  })

  it('maps content / safety reasons to "content"', () => {
    expect(normalizeFinishReason('content_filter')).toBe('content')
    expect(normalizeFinishReason('SAFETY')).toBe('content')
    expect(normalizeFinishReason('recitation')).toBe('content')
  })

  it('maps unknown non-empty reasons to "other"', () => {
    expect(normalizeFinishReason('tool_calls')).toBe('other')
    expect(normalizeFinishReason('tool_use')).toBe('other')
    expect(normalizeFinishReason('whatever')).toBe('other')
  })

  it('returns undefined for missing values', () => {
    expect(normalizeFinishReason(null)).toBeUndefined()
    expect(normalizeFinishReason(undefined)).toBeUndefined()
    expect(normalizeFinishReason('')).toBeUndefined()
  })
})
