import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RetrievedChunk } from './vectorStore.js'

// Mock the vector store so we can drive retrieve()'s formatting/filtering with
// fixed hits — the real search hits better-sqlite3 + sqlite-vec (not unit-testable).
const hits = vi.hoisted(() => ({ value: [] as RetrievedChunk[] }))
vi.mock('./vectorStore.js', () => ({
  search: async () => hits.value
}))

const { retrieve, retrieveContext } = await import('./ragRetriever.js')

function hit(over: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    id: over.id ?? 1,
    sourceKind: over.sourceKind ?? 'session',
    sourceId: over.sourceId ?? 'sess-1234-5678',
    sourceLabel: over.sourceLabel ?? null,
    speaker: over.speaker ?? null,
    ts: over.ts ?? Date.UTC(2026, 0, 2),
    text: over.text ?? 'some text',
    distance: over.distance ?? 0.5
  }
}

beforeEach(() => {
  hits.value = []
})

describe('retrieve', () => {
  it('returns empty prompt + sources when nothing is retrieved', async () => {
    const r = await retrieve('q')
    expect(r.prompt).toBe('')
    expect(r.sources).toEqual([])
  })

  it('filters out hits beyond the distance threshold', async () => {
    hits.value = [hit({ id: 1, distance: 0.4 }), hit({ id: 2, distance: 5 })]
    const r = await retrieve('q', { distanceThreshold: 1.0 })
    expect(r.sources.map((s) => s.id)).toEqual([1])
  })

  it('labels and tags doc / session / recap sources distinctly', async () => {
    hits.value = [
      hit({ id: 1, sourceKind: 'doc', sourceLabel: 'resume.pdf', distance: 0.2 }),
      hit({ id: 2, sourceKind: 'session', sourceId: 'abcdef0123', distance: 0.3 }),
      hit({ id: 3, sourceKind: 'recap', sourceId: 'fedcba9876', distance: 0.4 })
    ]
    const r = await retrieve('q')
    const byId = new Map(r.sources.map((s) => [s.id, s]))
    expect(byId.get(1)).toMatchObject({ kind: 'doc', label: 'resume.pdf' })
    expect(byId.get(2)).toMatchObject({ kind: 'session', label: 'session abcdef01' })
    expect(byId.get(3)).toMatchObject({ kind: 'recap', label: 'recap fedcba98' })
  })

  it('wraps the prompt block in <retrieved_context> and renders doc fragments', async () => {
    hits.value = [
      hit({ sourceKind: 'doc', sourceLabel: 'spec.md', text: 'the spec body', distance: 0.1 })
    ]
    const r = await retrieve('q')
    expect(r.prompt).toContain('<retrieved_context>')
    expect(r.prompt).toContain('[document · spec.md]')
    expect(r.prompt).toContain('the spec body')
  })

  it('truncates long snippets with an ellipsis but keeps the prompt full', async () => {
    const long = 'x'.repeat(500)
    hits.value = [hit({ text: long, distance: 0.1 })]
    const r = await retrieve('q')
    expect(r.sources[0]!.snippet.endsWith('…')).toBe(true)
    expect(r.sources[0]!.snippet.length).toBeLessThan(long.length)
    expect(r.prompt).toContain(long) // full text still goes to the model
  })

  it('retrieveContext returns only the prompt string', async () => {
    hits.value = [hit({ text: 'hello', distance: 0.1 })]
    expect(await retrieveContext('q')).toContain('<retrieved_context>')
  })
})
