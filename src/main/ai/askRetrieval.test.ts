import type { BrowserWindow } from 'electron'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '../../shared/ipc-channels.js'
import {
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT
} from '../../shared/prompts.js'
import type { LlmFinishReason, LlmStreamArgs } from '../providers/types.js'
import type { IEmbeddingProvider } from '../rag/embeddingProvider.js'

const llm = vi.hoisted(() => ({ prompts: [] as string[], firstPromptAt: 0 }))
const store = vi.hoisted(() => ({
  rows: [] as unknown[],
  hits: [] as unknown[],
  loadEmbedder: (): Promise<unknown> => new Promise(() => {}),
  embedderLoads: 0,
  embedded: [] as string[]
}))
const web = vi.hoisted(() => ({ enabled: false, queries: [] as string[] }))

// The real retriever and vector store run; only the SQLite handle and the
// on-device embedder (both bound to Electron) are replaced.
vi.mock('../rag/db.js', () => ({
  getDb: async () => ({
    prepare: () => ({
      get: () => store.rows[0],
      all: () => store.hits
    })
  })
}))
vi.mock('../rag/embeddingProvider.js', () => ({
  getLocalEmbedder: () => {
    store.embedderLoads++
    return store.loadEmbedder()
  }
}))
vi.mock('../settings.js', () => ({ getSettings: () => ({ meetingContext: '' }) }))
vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: { onSegment: () => {}, onState: () => {}, getState: () => ({ kind: 'idle' }) }
}))
vi.mock('../providers/registry.js', () => ({
  getActiveWebSearch: () =>
    web.enabled
      ? {
          id: 'tavily',
          search: async (query: string) => {
            web.queries.push(query)
            return []
          }
        }
      : null,
  getLlmProviderById: (id: string) => ({
    id,
    label: 'Fake',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason, void> {
      if (llm.prompts.length === 0) llm.firstPromptAt = performance.now()
      llm.prompts.push(args.prompt)
      yield 'answer'
      return 'stop'
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
  webSearchAllowed: () => web.enabled
}))
vi.mock('../personas/store.js', () => ({ getPersona: () => null }))
vi.mock('../sync/sessionSync.js', () => ({ recordAiExchange: async () => {} }))

const { ask, registerAiWindow } = await import('./aiGatewayClient.js')
type AskOptions = Parameters<typeof ask>[0]

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

// A cold embedder used to hold the question for the full retrieval budget (1.5 s).
const NO_WAIT_MS = 500

let requestSeq = 0

async function askAndWait(prompt: string, extra: Partial<AskOptions> = {}): Promise<number> {
  const requestId = `r${++requestSeq}`
  const startedAt = performance.now()
  await ask({ requestId, prompt, ...extra })
  await vi.waitFor(() => expect(sent).toContainEqual({ channel: IPC.ai.done, requestId }), {
    timeout: 5000
  })
  return llm.firstPromptAt - startedAt
}

beforeEach(() => {
  llm.prompts.length = 0
  llm.firstPromptAt = 0
  store.rows = []
  store.hits = []
  store.embedderLoads = 0
  store.embedded = []
  store.loadEmbedder = () => new Promise(() => {})
  web.enabled = false
  web.queries = []
})

const recordingEmbedder: IEmbeddingProvider = {
  dim: 384,
  model: 'fake',
  embed: async (texts) => {
    store.embedded.push(...texts)
    return texts.map(() => new Float32Array(384))
  }
}

describe('ask() retrieval', () => {
  it('does not wait on the embedder when nothing is indexed', async () => {
    const waitedMs = await askAndWait('What is our refund policy for annual plans?')

    expect(waitedMs).toBeLessThan(NO_WAIT_MS)
    expect(store.embedderLoads).toBe(0)
    expect(llm.prompts[0]).not.toContain('<retrieved_context>')
  })

  it('still tells the model there is no match for a question about past meetings', async () => {
    const waitedMs = await askAndWait('What did we agree on last time?')

    expect(waitedMs).toBeLessThan(NO_WAIT_MS)
    expect(llm.prompts[0]).toContain('No matching past sessions or documents.')
  })

  it('retrieves as before once something is indexed', async () => {
    const embedder: IEmbeddingProvider = {
      dim: 384,
      model: 'fake',
      embed: async (texts) => texts.map(() => new Float32Array(384))
    }
    store.rows = [{ one: 1 }]
    store.hits = [
      {
        id: 1,
        sourceKind: 'doc',
        sourceId: 'doc-1',
        sourceLabel: 'resume.pdf',
        speaker: null,
        ts: Date.UTC(2026, 0, 2),
        text: 'Led the payments platform team for three years',
        distance: 0.3
      }
    ]
    store.loadEmbedder = async () => embedder

    await askAndWait('Tell me about your payments experience')

    expect(store.embedderLoads).toBe(1)
    expect(llm.prompts[0]).toContain('<retrieved_context>')
    expect(llm.prompts[0]).toContain('Led the payments platform team for three years')
  })
})

describe('ask() with a prompt that carries a whole transcript', () => {
  const transcript = Array.from({ length: 300 }, (_, i) => `[Them] line${i}`).join('\n')
  const prompt = `Answer from the saved transcript.\n\n<transcript>\n${transcript}\n</transcript>\n\n<question>\nWhat did we decide about pricing?\n</question>`

  beforeEach(() => {
    web.enabled = true
    store.rows = [{ one: 1 }]
    store.loadEmbedder = async () => recordingEmbedder
  })

  it('searches nothing when the caller says the prompt is self-contained', async () => {
    await askAndWait(prompt, { skipRetrieval: true })

    expect(store.embedderLoads).toBe(0)
    expect(store.embedded).toEqual([])
    expect(web.queries).toEqual([])
    expect(llm.prompts[0]).not.toContain('<retrieved_context>')
    expect(llm.prompts[0]).toContain('[Them] line0\n')
    expect(llm.prompts[0]).toContain('What did we decide about pricing?')
  })

  it('never sends the transcript to web search or the embedder, only the last 60 words', async () => {
    await askAndWait(prompt)

    expect(web.queries).toHaveLength(1)
    const query = web.queries[0]!
    expect(query.split(/\s+/)).toHaveLength(60)
    expect(query).toContain('What did we decide about pricing?')
    expect(query).not.toContain('line0')
    expect(query).not.toContain('Answer from the saved transcript')
    expect(store.embedded).toEqual([query])
  })
})

describe('ask() with a chip that works on the previous answer', () => {
  it.each([
    ['Shorten', SHORTEN_PROMPT],
    ['Recap', RECAP_PROMPT],
    ['Follow-up', FOLLOW_UP_PROMPT],
    ['Screenshot', SCREENSHOT_DEFAULT_PROMPT]
  ])('searches nothing for %s', async (_name, prompt) => {
    web.enabled = true
    store.rows = [{ one: 1 }]
    store.loadEmbedder = async () => recordingEmbedder

    await askAndWait(prompt)

    expect(store.embedderLoads).toBe(0)
    expect(web.queries).toEqual([])
  })
})
