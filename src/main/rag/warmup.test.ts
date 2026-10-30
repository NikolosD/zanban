import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  mocks.emit({ kind: 'idle' })
  vi.useRealTimers()
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

  it.each([
    { shape: 'has no retrieval settings', persona: {} },
    { shape: 'was deleted', persona: null }
  ])('loads the embedder when the active persona $shape', async ({ persona }) => {
    mocks.activePersonaId = 'builtin:general'
    mocks.persona = persona
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

// The embedder unloads after 5 idle minutes.
describe('keeping the embedder loaded during a session', () => {
  const MINUTE = 60_000

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('pings it every 4 minutes while the session runs', async () => {
    mocks.emit(running('a'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4 * MINUTE - 1)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(4)
  })

  it.each([
    { stop: 'is stopping', state: { kind: 'stopping' } as SessionState },
    { stop: 'has ended', state: { kind: 'idle' } as SessionState }
  ])('stops pinging once the session $stop', async ({ state }) => {
    mocks.emit(running('a'))
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)

    mocks.emit(state)
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)
  })

  it('does not ping before the session is running', async () => {
    mocks.emit({ kind: 'starting' })
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('counts the 4 minutes from the start of the next session', async () => {
    mocks.emit(running('a'))
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    mocks.emit({ kind: 'idle' })
    mocks.emit(running('b'))
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(3)
  })

  it('checks the warm-up conditions again at every ping', async () => {
    mocks.emit(running('a'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)

    mocks.activePersonaId = 'custom:brainstorm'
    mocks.persona = { ragStrategy: { useRag: false } }
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)

    mocks.persona = { ragStrategy: { useRag: true } }
    mocks.hasChunks.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(1)

    mocks.hasChunks.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)
  })

  it('keeps pinging after a ping fails', async () => {
    mocks.getLocalEmbedder.mockResolvedValueOnce(null)
    mocks.emit(running('a'))
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4 * MINUTE)
    expect(mocks.getLocalEmbedder).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
