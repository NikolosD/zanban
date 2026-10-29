import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '../../shared/types.js'

const mocks = vi.hoisted(() => ({
  emit: (_state: SessionState): void => {},
  activePersonaId: null as string | null,
  persona: null as { ragStrategy?: { useRag: boolean } } | null,
  hasChunks: vi.fn(async () => true),
  getLocalEmbedder: vi.fn(async (): Promise<object | null> => ({}))
}))

vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: {
    onState: (cb: (state: SessionState) => void) => {
      mocks.emit = cb
      return () => {}
    }
  }
}))
vi.mock('../settings.js', () => ({
  getSettings: () => ({ activePersonaId: mocks.activePersonaId })
}))
vi.mock('../personas/store.js', () => ({ getPersona: () => mocks.persona }))
vi.mock('./vectorStore.js', () => ({ hasChunks: mocks.hasChunks }))
vi.mock('./embeddingProvider.js', () => ({ getLocalEmbedder: mocks.getLocalEmbedder }))

const { registerRagWarmup } = await import('./warmup.js')

const running = (sessionId: string): SessionState => ({
  kind: 'running',
  sessionId,
  startedAt: 0
})

// Warm-up starts on a later turn of the event loop; a callback queued here
// runs after it, with every promise it awaits already settled.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activePersonaId = null
  mocks.persona = null
  mocks.hasChunks.mockResolvedValue(true)
  mocks.getLocalEmbedder.mockResolvedValue({})
  registerRagWarmup()
})

describe('embedder warm-up', () => {
  it('loads the embedder once per session start', async () => {
    mocks.emit({ kind: 'starting' })
    mocks.emit(running('a'))
    mocks.emit({ kind: 'stopping' })
    mocks.emit({ kind: 'idle' })
    await flush()
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)

    mocks.emit({ kind: 'starting' })
    mocks.emit(running('b'))
    await flush()
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)
  })

  it('does nothing before the session is running', async () => {
    mocks.emit({ kind: 'starting' })
    await flush()
    expect(mocks.hasChunks).not.toHaveBeenCalled()
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('leaves the session start untouched while it loads', async () => {
    mocks.getLocalEmbedder.mockReturnValue(new Promise(() => {}))
    mocks.emit(running('a'))
    expect(mocks.hasChunks).not.toHaveBeenCalled()
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
    await flush()
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)
  })

  it('skips the load when nothing is indexed', async () => {
    mocks.hasChunks.mockResolvedValue(false)
    mocks.emit(running('a'))
    await flush()
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('skips the load when the active persona turned retrieval off', async () => {
    mocks.activePersonaId = 'custom:brainstorm'
    mocks.persona = { ragStrategy: { useRag: false } }
    mocks.emit(running('a'))
    await flush()
    expect(mocks.hasChunks).not.toHaveBeenCalled()
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('loads the embedder for a persona that keeps retrieval on', async () => {
    mocks.activePersonaId = 'custom:interview'
    mocks.persona = { ragStrategy: { useRag: true } }
    mocks.emit(running('a'))
    await flush()
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)
  })

  it('treats a failed load as a warning and tries again at the next session', async () => {
    mocks.getLocalEmbedder.mockResolvedValueOnce(null)
    expect(() => mocks.emit(running('a'))).not.toThrow()
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)

    mocks.emit(running('b'))
    await flush()
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('swallows an error thrown while warming up', async () => {
    mocks.hasChunks.mockRejectedValueOnce(new Error('database is locked'))
    expect(() => mocks.emit(running('a'))).not.toThrow()
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })
})
