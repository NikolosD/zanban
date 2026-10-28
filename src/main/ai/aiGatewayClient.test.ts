import { describe, it, expect, vi } from 'vitest'
import { ANSWER_LAST_PROMPT, RECAP_PROMPT } from '../../shared/prompts.js'
import type { TranscriptSegment } from '../../shared/types.js'

// The client wires itself into settings, the session manager, RAG and the
// persona store at import time — stub them so only the pure helpers run.
vi.mock('../settings.js', () => ({ getSettings: () => ({}) }))
vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: { onSegment: () => {}, getState: () => ({ kind: 'idle' }) }
}))
vi.mock('../rag/index.js', () => ({ retrieve: async () => ({ prompt: '', sources: [] }) }))
vi.mock('../providers/registry.js', () => ({
  getActiveLlmProvider: () => null,
  getActiveVisionProvider: () => null,
  getActiveWebSearch: () => null,
  getLlmProviderById: () => null
}))
vi.mock('../personas/store.js', () => ({ getPersona: () => null }))
vi.mock('../sync/sessionSync.js', () => ({ recordAiExchange: async () => {} }))

const { describeProviderError, retrievalQueryFor } = await import('./aiGatewayClient.js')

function withStatus(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

describe('describeProviderError', () => {
  it('maps an SDK 401 to an actionable key message', () => {
    const err = withStatus(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      401
    )
    expect(describeProviderError(err, 'Anthropic')).toBe(
      'Anthropic rejected the API key (401). Check it in Settings → AI.'
    )
  })

  it('reads statusCode (AI SDK / gateway errors) and a leading status in the message', () => {
    const gw = Object.assign(new Error('Invalid API key'), { statusCode: 403 })
    expect(describeProviderError(gw, 'Vercel AI Gateway')).toContain('rejected the API key (403)')
    expect(describeProviderError(new Error('401 Unauthorized'), 'Groq')).toContain(
      'Groq rejected the API key (401)'
    )
  })

  it("trims a JSON body down to the provider's message", () => {
    const anthropic = withStatus(
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      529
    )
    expect(describeProviderError(anthropic, 'Anthropic')).toBe('Anthropic: Overloaded (529)')
    const gemini = withStatus(
      '{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}',
      400
    )
    expect(describeProviderError(gemini, 'Google Gemini')).toBe(
      'Google Gemini: API key not valid. (400)'
    )
  })

  it('leaves plain messages untouched', () => {
    expect(describeProviderError(new Error('Model not found'), 'OpenAI')).toBe('Model not found')
    expect(describeProviderError('boom', 'OpenAI')).toBe('boom')
  })
})

function seg(over: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: over.id ?? 'id',
    channel: over.channel ?? 'system',
    speaker: 0,
    startMs: 0,
    endMs: 0,
    text: over.text ?? '',
    isFinal: over.isFinal ?? true,
    createdAt: 0
  }
}

describe('retrievalQueryFor', () => {
  it('keeps a free-form user prompt as the query', () => {
    expect(retrievalQueryFor('what is our Q3 churn?', [seg({ text: 'hello' })])).toBe(
      'what is our Q3 churn?'
    )
  })

  it("uses the other speaker's latest final segments for a fixed prompt", () => {
    const segments = [
      seg({ channel: 'system', text: 'How do you scale Postgres?' }),
      seg({ channel: 'mic', text: 'Good question' }),
      seg({ channel: 'system', text: 'partial', isFinal: false })
    ]
    expect(retrievalQueryFor(ANSWER_LAST_PROMPT, segments)).toBe('How do you scale Postgres?')
  })

  it('falls back to the mic channel when the other side said nothing', () => {
    expect(retrievalQueryFor(RECAP_PROMPT, [seg({ channel: 'mic', text: 'we ship friday' })])).toBe(
      'we ship friday'
    )
  })

  it('caps the query to the most recent 60 words', () => {
    const old = seg({ text: Array.from({ length: 50 }, () => 'old').join(' ') })
    const recent = seg({ text: Array.from({ length: 50 }, () => 'new').join(' ') })
    const words = retrievalQueryFor(ANSWER_LAST_PROMPT, [old, recent]).split(' ')
    expect(words).toHaveLength(60)
    expect(words.filter((w) => w === 'new')).toHaveLength(50)
  })

  it('returns an empty query for a fixed prompt with no transcript', () => {
    expect(retrievalQueryFor(ANSWER_LAST_PROMPT, [])).toBe('')
  })
})
