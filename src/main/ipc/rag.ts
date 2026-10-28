import { IPC } from '../../shared/ipc-channels.js'
import {
  countChunks as ragCountChunks,
  deleteSession as ragDeleteSession,
  search as ragSearch
} from '../rag/index.js'
import { isValidSessionId } from '../sync/sessionSync.js'
import { handleIpc } from './guard.js'

export function registerRagHandlers(): void {
  handleIpc(IPC.rag.search, (_e, query: string, k?: number) => ragSearch(query, k ?? 6))
  handleIpc(IPC.rag.deleteSession, (_e, sessionId: string) => {
    if (!isValidSessionId(sessionId)) return
    return ragDeleteSession(sessionId)
  })
  handleIpc(IPC.rag.count, () => ragCountChunks())
}
