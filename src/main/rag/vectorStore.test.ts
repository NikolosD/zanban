import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: null as object | null,
  rows: [] as unknown[],
  hits: [] as unknown[],
  getLocalEmbedder: vi.fn(async (): Promise<object | null> => null)
}))

vi.mock('./db.js', () => ({ getDb: async () => mocks.db }))
vi.mock('./embeddingProvider.js', () => ({ getLocalEmbedder: mocks.getLocalEmbedder }))

const { hasChunks, search } = await import('./vectorStore.js')

function useDb(): void {
  mocks.db = {
    prepare: () => ({ get: () => mocks.rows[0], all: () => mocks.hits })
  }
}

function useEmbedder(): { embed: ReturnType<typeof vi.fn> } {
  const embedder = { embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(4))) }
  mocks.getLocalEmbedder.mockResolvedValue(embedder)
  return embedder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows = []
  mocks.hits = []
  mocks.getLocalEmbedder.mockResolvedValue(null)
  useDb()
})

describe('hasChunks', () => {
  it('is true only when the chunks table has a row', async () => {
    expect(await hasChunks()).toBe(false)
    mocks.rows = [{ one: 1 }]
    expect(await hasChunks()).toBe(true)
  })

  it('is false when the database is unavailable', async () => {
    mocks.db = null
    expect(await hasChunks()).toBe(false)
  })
})

describe('search', () => {
  it('returns nothing without touching the embedder when nothing is indexed', async () => {
    useEmbedder()
    expect(await search('refund policy')).toEqual([])
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('embeds the query and returns the nearest rows once something is indexed', async () => {
    const embedder = useEmbedder()
    mocks.rows = [{ one: 1 }]
    mocks.hits = [{ id: 7, text: 'a refund takes five days', distance: 0.4 }]
    expect(await search('refund policy')).toEqual(mocks.hits)
    expect(embedder.embed).toHaveBeenCalledWith(['refund policy'])
  })

  it('returns nothing for a blank query', async () => {
    useEmbedder()
    mocks.rows = [{ one: 1 }]
    expect(await search('   ')).toEqual([])
    expect(mocks.getLocalEmbedder).not.toHaveBeenCalled()
  })

  it('returns nothing when the embedder could not load', async () => {
    mocks.rows = [{ one: 1 }]
    mocks.hits = [{ id: 7 }]
    expect(await search('refund policy')).toEqual([])
  })
})
