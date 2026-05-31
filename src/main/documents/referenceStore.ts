import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import Store from 'electron-store'
import { MAX_TEXT_PER_DOC, type ReferenceDoc } from '../../shared/types.js'
import { extractFromPath } from './extractors.js'
import { indexDoc, dropDoc } from '../rag/index.js'

interface PersistedShape {
  docs: ReferenceDoc[]
}

const store = new Store<PersistedShape>({
  name: 'reference-docs',
  defaults: { docs: [] }
})

export function listDocs(): ReferenceDoc[] {
  return (store.store.docs ?? []).slice().sort((a, b) => b.addedAt - a.addedAt)
}

export function getDoc(id: string): ReferenceDoc | undefined {
  return listDocs().find((d) => d.id === id)
}

export async function addDoc(filePath: string): Promise<ReferenceDoc> {
  const { text, kind, bytes } = await extractFromPath(filePath)
  const truncated = text.length > MAX_TEXT_PER_DOC
  const trimmed = truncated ? text.slice(0, MAX_TEXT_PER_DOC) : text
  const doc: ReferenceDoc = {
    id: randomUUID(),
    name: basename(filePath),
    kind,
    bytes,
    text: trimmed,
    // Empty-text docs (e.g. scanned PDFs with no text layer) are flagged so the
    // UI can warn the user; `truncated` flags a doc that hit MAX_TEXT_PER_DOC.
    extractEmpty: trimmed.trim().length === 0,
    truncated,
    active: true,
    addedAt: Date.now()
  }
  const docs = listDocs()
  docs.unshift(doc)
  store.set('docs', docs)
  // Index into the shared RAG store so only relevant fragments (not the whole
  // doc) reach the prompt. Best-effort — a failed index just means no retrieval.
  await indexDoc(doc).catch((err) => console.error('[documents] index failed', err))
  return doc
}

export function removeDoc(id: string): void {
  store.set(
    'docs',
    listDocs().filter((d) => d.id !== id)
  )
  void dropDoc(id).catch((err) => console.error('[documents] drop failed', err))
}

export function setActive(id: string, active: boolean): void {
  const next = listDocs().map((d) => (d.id === id ? { ...d, active } : d))
  store.set('docs', next)
  const doc = next.find((d) => d.id === id)
  // Re-index on (re)activation; drop chunks on deactivation. indexDoc itself
  // drops first and no-ops for inactive/empty docs, so this stays idempotent.
  if (doc) void indexDoc(doc).catch((err) => console.error('[documents] reindex failed', err))
}
