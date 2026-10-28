import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionDetailPayload } from '../../shared/api.js'
import type { Chunk } from './semanticChunker.js'

const state = vi.hoisted(() => ({
  embedderReady: true,
  embedderLoads: 0,
  liveSessionId: null as string | null,
  present: new Set<string>(),
  sessions: [] as Array<Omit<SessionDetailPayload, 'filePath'>>,
  recaps: new Set<string>(),
  indexed: new Map<string, Chunk[]>(),
  recapIndexed: new Map<string, number>(),
  cleared: 0
}))

vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))
vi.mock('./db.js', () => ({
  clearBackfillPending: async () => {
    state.cleared++
  }
}))
vi.mock('./embeddingProvider.js', () => ({
  getLocalEmbedder: async () => {
    state.embedderLoads++
    return state.embedderReady ? {} : null
  }
}))
vi.mock('./vectorStore.js', () => ({
  hasSource: async (kind: string, id: string) => state.present.has(`${kind}:${id}`),
  indexChunks: async (id: string, chunks: Chunk[]) => {
    state.indexed.set(id, chunks)
    return chunks.length
  }
}))
vi.mock('./recapIndexer.js', () => ({
  indexRecap: async (id: string, _recap: unknown, meetingAt: number) => {
    state.recapIndexed.set(id, meetingAt)
    return 1
  }
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<void>) => fn()
}))
vi.mock('../sync/sessionSync.js', () => ({
  listSessionsFromDisk: async () => state.sessions.map((s) => ({ id: s.id })),
  readSessionFromDisk: async (id: string) => {
    if (id === 'corrupt') throw new Error('bad json')
    return state.sessions.find((s) => s.id === id) ?? null
  },
  getSessionsDir: () => '/sessions'
}))
vi.mock('../services/recap/recapPersistence.js', () => ({
  readRecap: async (_dir: string, id: string) => (state.recaps.has(id) ? { tldr: 'x' } : null)
}))
vi.mock('../transcription/sessionManager.js', () => ({
  sessionManager: {
    getState: () =>
      state.liveSessionId ? { kind: 'running', sessionId: state.liveSessionId } : { kind: 'idle' }
  }
}))

const { backfillSessions } = await import('./sessionBackfill.js')

function session(id: string, startedAt = Date.UTC(2026, 0, 5)): (typeof state.sessions)[number] {
  return {
    id,
    startedAt,
    endedAt: startedAt + 60_000,
    title: null,
    exchanges: [],
    segments: [
      { channel: 'system', startMs: 1000, text: 'Какие ожидания по зарплате?' },
      { channel: 'mic', startMs: 4000, text: 'Пятьдесят тысяч.' }
    ]
  }
}

beforeEach(() => {
  state.embedderReady = true
  state.embedderLoads = 0
  state.liveSessionId = null
  state.present = new Set()
  state.sessions = []
  state.recaps = new Set()
  state.indexed = new Map()
  state.recapIndexed = new Map()
  state.cleared = 0
})

describe('backfillSessions', () => {
  it('re-indexes past transcripts and recaps, then clears the pending flag', async () => {
    state.sessions = [session('a')]
    state.recaps = new Set(['a'])
    await backfillSessions()
    const chunks = state.indexed.get('a')!
    expect(chunks.map((c) => c.text)).toEqual([
      'Them: Какие ожидания по зарплате?\nYou: Пятьдесят тысяч.'
    ])
    expect(chunks[0]!.ts).toBe(Date.UTC(2026, 0, 5) + 1000)
    expect(state.recapIndexed.get('a')).toBe(Date.UTC(2026, 0, 5))
    expect(state.cleared).toBe(1)
  })

  it('skips the live call and sources that are already indexed', async () => {
    state.sessions = [session('live'), session('done'), session('half')]
    state.recaps = new Set(['done', 'half'])
    state.liveSessionId = 'live'
    state.present = new Set(['session:done', 'recap:done', 'session:half'])
    await backfillSessions()
    expect([...state.indexed.keys()]).toEqual([])
    expect([...state.recapIndexed.keys()]).toEqual(['half'])
  })

  it('clears the flag without loading the embedder when there are no meetings', async () => {
    await backfillSessions()
    expect(state.embedderLoads).toBe(0)
    expect(state.cleared).toBe(1)
  })

  it('keeps the flag set when the embedder is unavailable', async () => {
    state.sessions = [session('a')]
    state.embedderReady = false
    await backfillSessions()
    expect(state.indexed.size).toBe(0)
    expect(state.cleared).toBe(0)
  })

  it('keeps going past a failing session but leaves the flag for a retry', async () => {
    state.sessions = [session('corrupt'), session('b')]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await backfillSessions()
    expect(state.indexed.has('b')).toBe(true)
    expect(state.cleared).toBe(0)
  })
})
