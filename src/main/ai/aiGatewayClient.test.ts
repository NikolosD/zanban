import type { BrowserWindow } from 'electron'
import { describe, it, expect, vi } from 'vitest'
import { IPC } from '../../shared/ipc-channels.js'
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '../../shared/prompts.js'
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

const them = (text: string, over: Partial<TranscriptSegment> = {}): TranscriptSegment =>
  seg({ ...over, channel: 'system', text })
const you = (text: string): TranscriptSegment => seg({ channel: 'mic', text })

const NO_SEARCH_PROMPTS: Array<[string, string]> = [
  ['Shorten', SHORTEN_PROMPT],
  ['Recap', RECAP_PROMPT],
  ['Screenshot', SCREENSHOT_DEFAULT_PROMPT],
  ['Follow-up', FOLLOW_UP_PROMPT]
]
const QUESTION_PROMPTS: Array<[string, string]> = [
  ['Answer last', ANSWER_LAST_PROMPT],
  ['What to answer', WHAT_TO_ANSWER_PROMPT]
]

const SPEECH = [
  {
    language: 'English',
    opener: 'Thanks for joining today.',
    question: 'So, how do you handle database migrations at scale?',
    followUp: 'We have about ten services and a lot of traffic.',
    yourQuestion: 'Do you mean schema changes or data backfills?',
    shortQuestion: 'Right?',
    remark: 'We shipped the migration last week and everything went fine.'
  },
  {
    language: 'Russian',
    opener: 'Спасибо, что пришли.',
    question: 'Как вы подходите к миграциям базы данных в большом проекте?',
    followUp: 'У нас около десяти сервисов и много трафика.',
    yourQuestion: 'Вы имеете в виду изменения схемы или перенос данных?',
    shortQuestion: 'Да?',
    remark: 'Мы выкатили миграцию на прошлой неделе, и всё прошло хорошо.'
  }
]

describe('retrievalQueryFor', () => {
  describe('a typed prompt', () => {
    it('stays the query when it is short', () => {
      expect(retrievalQueryFor('what is our Q3 churn?', [them('hello')])).toBe(
        'what is our Q3 churn?'
      )
    })

    it('is cut to its last 60 words', () => {
      const words = Array.from({ length: 200 }, (_, i) => `w${i}`)
      expect(retrievalQueryFor(words.join(' '), [])).toBe(words.slice(-60).join(' '))
    })

    it('queries on the question at the end of a prompt that carries a whole transcript', () => {
      const transcript = Array.from({ length: 300 }, (_, i) => `[Them] line${i}`).join('\n')
      const prompt = `Answer from the transcript.\n\n<transcript>\n${transcript}\n</transcript>\n\n<question>\nWhat did we decide about pricing?\n</question>`
      const query = retrievalQueryFor(prompt, [])
      expect(query.split(/\s+/)).toHaveLength(60)
      expect(query).toMatch(/line299 <\/transcript> <question> What did we decide about pricing\? /)
      expect(query).not.toContain('Answer from the transcript')
      expect(query).not.toContain('line0')
    })
  })

  describe.each(SPEECH)('$language speech', (speech) => {
    it.each(NO_SEARCH_PROMPTS)('searches nothing for %s', (_name, prompt) => {
      const segments = [them(speech.opener), them(speech.question), you(speech.remark)]
      expect(retrievalQueryFor(prompt, segments)).toBe('')
    })

    describe.each(QUESTION_PROMPTS)('%s', (_name, prompt) => {
      it('queries on the last question the other speaker asked', () => {
        const segments = [them(speech.opener), them(speech.question), them(speech.followUp)]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.question)
      })

      it('takes the later of two questions', () => {
        const segments = [them(speech.question), them(speech.opener), them(speech.yourQuestion)]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.yourQuestion)
      })

      it("ignores the user's own questions", () => {
        const segments = [them(speech.question), you(speech.yourQuestion)]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.question)
      })

      it('skips a question too short to search on', () => {
        const segments = [them(speech.question), them(speech.shortQuestion)]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.question)
      })

      it('joins a question that was split across segments', () => {
        const words = speech.question.split(' ')
        const segments = [
          them(words.slice(0, 3).join(' ')),
          them(`${words.slice(3).join(' ')} ${speech.followUp}`)
        ]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.question)
      })

      it('ignores a question that is still being spoken', () => {
        const segments = [them(speech.remark), them(speech.question, { isFinal: false })]
        expect(retrievalQueryFor(prompt, segments)).toBe(speech.remark)
      })

      it('falls back to their latest words when they asked nothing', () => {
        const segments = [them(speech.opener), them(speech.remark)]
        expect(retrievalQueryFor(prompt, segments)).toBe(`${speech.opener} ${speech.remark}`)
      })

      it('falls back to their latest words when every question is too short', () => {
        const segments = [them(speech.remark), them(speech.shortQuestion)]
        expect(retrievalQueryFor(prompt, segments)).toBe(`${speech.remark} ${speech.shortQuestion}`)
      })

      it('caps that fallback to the most recent 60 words', () => {
        const old = them(Array.from({ length: 50 }, () => 'old').join(' '))
        const recent = them(Array.from({ length: 50 }, () => 'new').join(' '))
        const words = retrievalQueryFor(prompt, [old, recent]).split(' ')
        expect(words).toHaveLength(60)
        expect(words.filter((w) => w === 'new')).toHaveLength(50)
      })

      it('uses the mic channel when the other side said nothing', () => {
        expect(retrievalQueryFor(prompt, [you(speech.question)])).toBe(speech.question)
        expect(retrievalQueryFor(prompt, [you(speech.remark)])).toBe(speech.remark)
      })

      it('returns an empty query when nothing was said', () => {
        expect(retrievalQueryFor(prompt, [])).toBe('')
      })
    })
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
