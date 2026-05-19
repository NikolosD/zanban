import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  addDoc as addReferenceDoc,
  listDocs as listReferenceDocs,
  removeDoc as removeReferenceDoc,
  setActive as setReferenceDocActive
} from '../documents/referenceStore.js'
import { exportSessionPdf } from '../documents/pdfExporter.js'
import type { SessionExportPayload } from '../../shared/types.js'

export function registerDocumentsHandlers(): void {
  ipcMain.handle(IPC.documents.list, () => listReferenceDocs())
  ipcMain.handle(IPC.documents.upload, async (_e, filePaths: string[]) => {
    if (!Array.isArray(filePaths)) return []
    const added = []
    for (const p of filePaths) {
      if (typeof p !== 'string' || p.length === 0 || p.length > 4096) {
        added.push({ error: 'invalid path', path: String(p) })
        continue
      }
      try {
        added.push(await addReferenceDoc(p))
      } catch (err) {
        added.push({ error: (err as Error).message, path: p })
      }
    }
    return added
  })
  ipcMain.handle(IPC.documents.remove, (_e, id: string) => {
    removeReferenceDoc(id)
    return listReferenceDocs()
  })
  ipcMain.handle(IPC.documents.setActive, (_e, id: string, active: boolean) => {
    setReferenceDocActive(id, active)
    return listReferenceDocs()
  })
  ipcMain.handle(IPC.documents.exportSessionPdf, (_e, payload: SessionExportPayload) =>
    exportSessionPdf(payload)
  )
}
