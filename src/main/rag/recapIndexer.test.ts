import { describe, it, expect, vi } from 'vitest'
import { indexRecap, recapToText, type IndexableRecap } from './recapIndexer.js'
import type { Chunk } from './semanticChunker.js'

// recapIndexer → vectorStore → db imports electron, whose binary isn't
// installed when CI runs `pnpm install --ignore-scripts`.
vi.mock('electron', () => ({ app: {} }))

const indexed = vi.hoisted(() => ({ chunks: [] as Chunk[] }))
vi.mock('./vectorStore.js', () => ({
  deleteRecap: async () => 0,
  indexRecapChunks: async (_id: string, chunks: Chunk[]) => {
    indexed.chunks = chunks
    return chunks.length
  }
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<number>) => fn()
}))
vi.mock('../sync/sessionSync.js', () => ({
  readSessionFromDisk: async () => ({ startedAt: Date.UTC(2026, 2, 3) })
}))

function recap(over: Partial<IndexableRecap> = {}): IndexableRecap {
  return {
    tldr: '',
    decisions: [],
    actionItems: [],
    openQuestions: [],
    ...over
  }
}

describe('recapToText', () => {
  it('returns an empty string when the recap is empty', () => {
    expect(recapToText(recap())).toBe('')
  })

  it('includes the TL;DR as a Summary line', () => {
    expect(recapToText(recap({ tldr: 'We shipped the thing.' }))).toContain(
      'Summary: We shipped the thing.'
    )
  })

  it('joins decisions with semicolons', () => {
    const out = recapToText(recap({ decisions: ['use Postgres', 'ship Friday'] }))
    expect(out).toContain('Decisions: use Postgres; ship Friday')
  })

  it('renders action items with owner labels and due hints', () => {
    const out = recapToText(
      recap({
        actionItems: [
          { text: 'send recap', owner: 'you', dueHint: 'today' },
          { text: 'review PR', owner: 'them' },
          { text: 'pick a date', owner: 'unknown' }
        ]
      })
    )
    expect(out).toContain('You — send recap (today)')
    expect(out).toContain('Them — review PR')
    expect(out).toContain('Someone — pick a date')
  })

  it('includes open questions', () => {
    expect(recapToText(recap({ openQuestions: ['who owns billing?'] }))).toContain(
      'Open questions: who owns billing?'
    )
  })

  it('omits sections that have no content', () => {
    const out = recapToText(recap({ tldr: 'only this' }))
    expect(out).not.toContain('Decisions:')
    expect(out).not.toContain('Action items:')
    expect(out).not.toContain('Open questions:')
  })
})

describe('indexRecap', () => {
  it("dates chunks with the meeting's start, not the indexing time", async () => {
    await indexRecap('sess-1', recap({ tldr: 'Agreed on Postgres.' }))
    expect(indexed.chunks.map((c) => c.ts)).toEqual([Date.UTC(2026, 2, 3)])
  })

  it('prefers an explicit meeting time', async () => {
    await indexRecap('sess-1', recap({ tldr: 'Agreed on Postgres.' }), 42)
    expect(indexed.chunks.map((c) => c.ts)).toEqual([42])
  })
})
