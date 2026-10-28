import { IPC } from '../../shared/ipc-channels.js'
import type { LlmProvider } from '../../shared/types.js'
import { testProviderConnection } from '../providers/testConnection.js'
import { handleIpc } from './guard.js'

export function registerProvidersHandlers(): void {
  handleIpc(IPC.providers.testConnection, (_e, id: LlmProvider) => testProviderConnection(id))
}
