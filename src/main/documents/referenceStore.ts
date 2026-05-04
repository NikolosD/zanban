import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import Store from 'electron-store'
import type { ReferenceDoc } from '../../shared/types.js'
import { extractFromPath } from './extractors.js'

interface PersistedShape {
  docs: ReferenceDoc[]
}

const store = new Store<PersistedShape>({
  name: 'reference-docs',
  defaults: { docs: [] }
})

const MAX_TEXT_PER_DOC = 200_000

export function listDocs(): ReferenceDoc[] {
  return (store.store.docs ?? []).slice().sort((a, b) => b.addedAt - a.addedAt)
}

export async function addDoc(filePath: string): Promise<ReferenceDoc> {
  const { text, kind, bytes } = await extractFromPath(filePath)
  const trimmed = text.length > MAX_TEXT_PER_DOC ? text.slice(0, MAX_TEXT_PER_DOC) : text
  const doc: ReferenceDoc = {
    id: randomUUID(),
    name: basename(filePath),
    kind,
    bytes,
    text: trimmed,
    active: true,
    addedAt: Date.now()
  }
  const docs = listDocs()
  docs.unshift(doc)
  store.set('docs', docs)
  return doc
}

export function removeDoc(id: string): void {
  store.set('docs', listDocs().filter((d) => d.id !== id))
}

export function setActive(id: string, active: boolean): void {
  store.set(
    'docs',
    listDocs().map((d) => (d.id === id ? { ...d, active } : d))
  )
}

/**
 * Plain-text dump of every active doc, formatted for prompt injection.
 * Returns empty string when no active doc — callers can append unconditionally.
 */
export function getActiveContext(): string {
  const active = listDocs().filter((d) => d.active)
  if (active.length === 0) return ''
  const blocks = active.map(
    (d) => `--- ${d.name} (${d.kind.toUpperCase()}) ---\n${d.text}`
  )
  return `\n\nReference documents the user uploaded:\n\n${blocks.join('\n\n')}`
}
