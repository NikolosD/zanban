import type { BrowserWindow } from 'electron'
import { describe, it, expect, vi } from 'vitest'
import { IPC } from '../../shared/ipc-channels.js'
import { ANSWER_LAST_PROMPT, RECAP_PROMPT } from '../../shared/prompts.js'
import type { TranscriptSegment } from '../../shared/types.js'
import type { LlmFinishReason, LlmStreamArgs } from '../providers/types.js'

const llm = vi.hoisted(() => ({
  prompts: [] as string[],
  replies: [] as Array<{ text: string; finish: 'stop' | 'length' }>
}))

// The client wires itself into settings, the session manager, RAG and the
// persona store at import time. The provider answers with `llm.replies`.
vi.mock('../settings.js', () => ({ getSettings: () => ({ meetingContext: '' }) }))
vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: { onSegment: () => {}, onState: () => {}, getState: () => ({ kind: 'idle' }) }
}))
vi.mock('../rag/index.js', () => ({ retrieve: async () => ({ prompt: '', sources: [] }) }))
vi.mock('../providers/registry.js', () => ({
  getActiveWebSearch: () => null,
  getLlmProviderById: (id: string) => ({
    id,
    label: 'Fake',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason, void> {
      llm.prompts.push(args.prompt)
      const reply = llm.replies.shift()!
      yield reply.text
      return reply.finish
    },
    generate: async () => ''
  })
}))
vi.mock('./models.js', () => ({
  availableModel: (_provider: string, model: string) => model,
  fastMaxOutputTokens: () => 600,
  modelFor: () => 'fake-model'
}))
vi.mock('./answerRouting.js', () => ({
  answerProviderId: () => 'anthropic',
  backupProviderIds: () => [],
  webSearchAllowed: () => false
}))
vi.mock('../personas/store.js', () => ({ getPersona: () => null }))
vi.mock('../sync/sessionSync.js', () => ({ recordAiExchange: async () => {} }))

const { ask, describeProviderError, registerAiWindow, retrievalQueryFor } =
  await import('./aiGatewayClient.js')

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
      'Anthropic rejected the API key (401). Check it in Settings → Keys & providers.'
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

describe('Continue', () => {
  const sent: Array<{ channel: string; requestId: string }> = []
  registerAiWindow({
    on: () => {},
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    webContents: {
      send: (channel: string, payload: { requestId: string }) =>
        sent.push({ channel, requestId: payload.requestId })
    }
  } as unknown as BrowserWindow)

  async function answer(opts: Parameters<typeof ask>[0]): Promise<void> {
    await ask(opts)
    await vi.waitFor(() =>
      expect(sent).toContainEqual({ channel: IPC.ai.done, requestId: opts.requestId })
    )
  }

  it('sends the whole cut answer back, through a chain of continues', async () => {
    const first = 'A'.repeat(900)
    const second = 'B'.repeat(900)
    llm.replies.push(
      { text: first, finish: 'length' },
      { text: second, finish: 'length' },
      { text: 'end', finish: 'stop' }
    )
    await answer({ requestId: 'r1', prompt: 'Explain sharding' })
    await answer({ requestId: 'r2', prompt: 'continue', continueFrom: 'r1' })
    await answer({ requestId: 'r3', prompt: 'continue', continueFrom: 'r2' })

    expect(llm.prompts[1]).toContain(
      `Explain sharding\n\n<answer_so_far>\n${first}\n</answer_so_far>`
    )
    expect(llm.prompts[2]).toContain(
      `Explain sharding\n\n<answer_so_far>\n${first}${second}\n</answer_so_far>`
    )
    // Sources belong to the answer being continued; a continuation leaves them be.
    expect(sent.filter((m) => m.channel === IPC.ai.sources).map((m) => m.requestId)).toEqual(['r1'])
  })
})
