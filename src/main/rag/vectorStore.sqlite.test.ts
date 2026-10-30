import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', embedderLoads: 0 }))

// The real db.ts, schema and SQL run against a SQLite file; only the userData
// path and the embedding model are stand-ins.
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('./embeddingProvider.js', () => ({
  LOCAL_EMBEDDING_DIM: 8,
  LOCAL_EMBEDDING_ID: 'test-embedder@1',
  getLocalEmbedder: async () => {
    state.embedderLoads++
    return {
      embed: async (texts: string[]) =>
        texts.map((text) => {
          const vec = new Float32Array(8)
          vec[text.length % 8] = 1
          return vec
        })
    }
  }
}))

state.userData = mkdtempSync(join(tmpdir(), 'zanban-rag-'))
const { closeDb } = await import('./db.js')
const { hasChunks, indexChunks, indexDocChunks, search } = await import('./vectorStore.js')

afterAll(() => {
  closeDb()
  rmSync(state.userData, { recursive: true, force: true })
})

describe('vector store on a real SQLite file', () => {
  it('answers an empty store without loading the embedder', async () => {
    expect(await hasChunks()).toBe(false)
    expect(await search('how do we shard postgres')).toEqual([])
    expect(state.embedderLoads).toBe(0)
  })

  it('finds a chunk on the very next search after it is indexed', async () => {
    await indexChunks('s1', [{ speaker: 'them', ts: 1, text: 'we shard by tenant id' }])
    expect(await hasChunks()).toBe(true)
    const hits = await search('we shard by tenant id')
    expect(hits.map((hit) => hit.text)).toEqual(['we shard by tenant id'])
  })

  it('stays non-empty while a document is re-indexed', async () => {
    await indexDocChunks('d1', 'pricing.pdf', [{ speaker: null, ts: 2, text: 'tier one' }])
    await indexDocChunks('d1', 'pricing.pdf', [{ speaker: null, ts: 3, text: 'tier two' }])
    expect(await hasChunks()).toBe(true)
  })
})
