import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  countChunks as ragCountChunks,
  deleteSession as ragDeleteSession,
  search as ragSearch
} from '../rag/index.js'

export function registerRagHandlers(): void {
  ipcMain.handle(IPC.rag.search, (_e, query: string, k?: number) => ragSearch(query, k ?? 6))
  ipcMain.handle(IPC.rag.deleteSession, (_e, sessionId: string) => ragDeleteSession(sessionId))
  ipcMain.handle(IPC.rag.count, () => ragCountChunks())
}
