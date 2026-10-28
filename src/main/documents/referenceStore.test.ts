import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  docs: [] as unknown[],
  texts: new Map<string, string>(),
  indexed: [] as string[]
}))

vi.mock('electron-store', () => ({
  default: class {
    get store(): { docs: unknown[] } {
      return { docs: state.docs }
    }
    set(_key: string, value: unknown[]): void {
      state.docs = value
    }
  }
}))
vi.mock('./extractors.js', () => ({
  extractFromPath: async (path: string) => ({
    kind: 'txt',
    text: state.texts.get(path) ?? '',
    bytes: 1
  })
}))
vi.mock('../rag/index.js', () => ({
  indexDoc: async (doc: { id: string }) => {
    state.indexed.push(doc.id)
    return 1
  },
  dropDoc: async () => {}
}))

const { addDoc, listDocs } = await import('./referenceStore.js')

beforeEach(() => {
  state.docs = []
  state.texts = new Map()
  state.indexed = []
})

describe('addDoc', () => {
  it('rejects a file whose text is already indexed, whatever its name', async () => {
    state.texts.set('/a/spec.md', 'The spec body.')
    state.texts.set('/b/spec copy.md', 'The spec body.')
    await addDoc('/a/spec.md')
    await expect(addDoc('/b/spec copy.md')).rejects.toThrow('"spec.md"')
    expect(listDocs()).toHaveLength(1)
    expect(state.indexed).toHaveLength(1)
  })

  it('detects duplicates of docs stored before hashes were recorded', async () => {
    state.docs = [{ id: 'old', name: 'cv.pdf', text: 'Seven years of React.', addedAt: 1 }]
    state.texts.set('/cv.pdf', 'Seven years of React.')
    await expect(addDoc('/cv.pdf')).rejects.toThrow('"cv.pdf"')
  })

  it('accepts distinct texts and repeated empty extractions', async () => {
    state.texts.set('/one.txt', 'one')
    state.texts.set('/two.txt', 'two')
    await addDoc('/one.txt')
    await addDoc('/two.txt')
    await addDoc('/scan-1.pdf')
    await addDoc('/scan-2.pdf')
    expect(listDocs()).toHaveLength(4)
  })
})
