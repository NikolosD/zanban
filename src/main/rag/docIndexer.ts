import type { ReferenceDoc } from '../../shared/types.js'
import { chunkText } from './semanticChunker.js'
import { deleteDoc, indexDocChunks, indexedDocIds } from './vectorStore.js'
import { trackJob } from '../services/jobsManager.js'

/**
 * (Re)index a single reference document into the shared vector store. The new
 * chunks replace the doc's old fragments atomically rather than duplicating
 * them. An inactive doc, or one with no extractable text, ends up with zero
 * indexed chunks — it contributes nothing to retrieval until reactivated /
 * re-extracted.
 */
export async function indexDoc(doc: ReferenceDoc): Promise<number> {
  const text = doc.text.trim()
  const chunks = doc.active && text ? chunkText(text, doc.addedAt) : []
  if (chunks.length === 0) {
    await deleteDoc(doc.id)
    return 0
  }
  return trackJob(`rag-doc-${doc.id}-${Date.now()}`, `Indexing ${doc.name}`, 'rag', () =>
    indexDocChunks(doc.id, doc.name, chunks)
  )
}

/** Drop a document's chunks from the vector store (on remove/deactivate). */
export async function dropDoc(docId: string): Promise<void> {
  await deleteDoc(docId)
}

/**
 * Reconcile the vector store with the persisted doc list on boot:
 *  - index any active doc whose chunks are missing (first run after the
 *    documents-into-RAG migration, or after a schema rebuild dropped them);
 *  - drop chunks for docs that were deleted while the app was closed, or that
 *    are now inactive.
 * Best-effort and fully async — failures are swallowed so a broken indexer
 * never blocks startup.
 */
export async function reconcileDocs(docs: ReferenceDoc[]): Promise<void> {
  try {
    const indexed = await indexedDocIds()
    const liveIds = new Set(docs.map((d) => d.id))

    // Drop chunks for docs that no longer exist on disk.
    for (const id of indexed) {
      if (!liveIds.has(id)) await deleteDoc(id)
    }

    // Index active docs that aren't represented yet; drop inactive ones that are.
    for (const doc of docs) {
      const present = indexed.has(doc.id)
      if (doc.active && doc.text.trim() && !present) {
        await indexDoc(doc)
      } else if (!doc.active && present) {
        await deleteDoc(doc.id)
      }
    }
  } catch (err) {
    console.error('[rag] doc reconcile failed', err)
  }
}
