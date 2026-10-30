import type { BrowserWindow } from 'electron'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '../../shared/ipc-channels.js'
import type { LlmFinishReason, LlmStreamArgs } from '../providers/types.js'
import type { IEmbeddingProvider } from '../rag/embeddingProvider.js'

const llm = vi.hoisted(() => ({ prompts: [] as string[], firstPromptAt: 0 }))
const store = vi.hoisted(() => ({
  rows: [] as unknown[],
  hits: [] as unknown[],
  loadEmbedder: (): Promise<unknown> => new Promise(() => {}),
  embedderLoads: 0
}))

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
  getActiveWebSearch: () => null,
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
  webSearchAllowed: () => false
}))
vi.mock('../personas/store.js', () => ({ getPersona: () => null }))
vi.mock('../sync/sessionSync.js', () => ({ recordAiExchange: async () => {} }))

const { ask, registerAiWindow } = await import('./aiGatewayClient.js')

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

async function askAndWait(prompt: string): Promise<number> {
  const requestId = `r${++requestSeq}`
  const startedAt = performance.now()
  await ask({ requestId, prompt })
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
  store.loadEmbedder = () => new Promise(() => {})
})

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
