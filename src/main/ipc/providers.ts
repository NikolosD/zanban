import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import type { LlmProvider } from '../../shared/types.js'
import { testProviderConnection } from '../providers/testConnection.js'

export function registerProvidersHandlers(): void {
  ipcMain.handle(IPC.providers.testConnection, (_e, id: LlmProvider) => testProviderConnection(id))
}
