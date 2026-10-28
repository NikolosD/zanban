import { stat } from 'node:fs/promises'
import { IPC } from '../../shared/ipc-channels.js'
import {
  addDoc as addReferenceDoc,
  listDocs as listReferenceDocs,
  removeDoc as removeReferenceDoc,
  setActive as setReferenceDocActive
} from '../documents/referenceStore.js'
import { exportSessionPdf } from '../documents/pdfExporter.js'
import type { SessionExportPayload } from '../../shared/types.js'
import { handleIpc } from './guard.js'
import { documentPathSchema, MAX_DOCUMENT_BYTES } from './schemas.js'

export function registerDocumentsHandlers(): void {
  handleIpc(IPC.documents.list, () => listReferenceDocs())
  handleIpc(IPC.documents.upload, async (_e, filePaths: unknown) => {
    if (!Array.isArray(filePaths)) return []
    const added = []
    for (const p of filePaths) {
      const parsed = documentPathSchema.safeParse(p)
      if (!parsed.success) {
        added.push({ error: parsed.error.issues[0]?.message ?? 'invalid path', path: String(p) })
        continue
      }
      try {
        const info = await stat(parsed.data)
        if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) {
          added.push({ error: 'not a regular file or larger than 50MB', path: parsed.data })
          continue
        }
        added.push(await addReferenceDoc(parsed.data))
      } catch (err) {
        added.push({ error: (err as Error).message, path: parsed.data })
      }
    }
    return added
  })
  handleIpc(IPC.documents.remove, (_e, id: string) => {
    removeReferenceDoc(id)
    return listReferenceDocs()
  })
  handleIpc(IPC.documents.setActive, (_e, id: string, active: boolean) => {
    setReferenceDocActive(id, active)
    return listReferenceDocs()
  })
  handleIpc(IPC.documents.exportSessionPdf, (_e, payload: SessionExportPayload) =>
    exportSessionPdf(payload)
  )
}
