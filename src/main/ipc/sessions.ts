import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  copySessionMarkdown,
  deleteSessionFromDisk,
  getSessionMdPath,
  getSessionsDir,
  isValidSessionId,
  listSessionsFromDisk,
  readSessionFromDisk,
  renameSessionOnDisk
} from '../sync/sessionSync.js'
import { deleteSession as ragDeleteSession } from '../rag/index.js'

export function registerSessionsHandlers(): void {
  ipcMain.handle(IPC.sessions.list, () => listSessionsFromDisk())
  ipcMain.handle(IPC.sessions.read, (_e, id: string) => {
    if (!isValidSessionId(id)) return null
    return readSessionFromDisk(id)
  })
  ipcMain.handle(IPC.sessions.revealFolder, () => shell.openPath(getSessionsDir()))
  ipcMain.handle(IPC.sessions.delete, async (_e, id: string) => {
    if (!isValidSessionId(id)) return { ok: false }
    const result = await deleteSessionFromDisk(id)
    if (result.ok) {
      try {
        await ragDeleteSession(id)
      } catch {
        /* RAG may be unavailable — non-fatal. */
      }
    }
    return result
  })
  ipcMain.handle(IPC.sessions.revealFile, (_e, id: string) => {
    if (!isValidSessionId(id)) return
    shell.showItemInFolder(getSessionMdPath(id))
  })
  ipcMain.handle(IPC.sessions.rename, async (_e, id: string, title: unknown) => {
    if (!isValidSessionId(id) || typeof title !== 'string') return { ok: false, title: null }
    return renameSessionOnDisk(id, title)
  })
  ipcMain.handle(IPC.sessions.exportMarkdown, async (e, id: string) => {
    if (!isValidSessionId(id)) return null
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = {
      title: 'Export session',
      defaultPath: `${id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await copySessionMarkdown(id, result.filePath)
    return result.filePath
  })
}
