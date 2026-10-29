import { IPC } from '../../shared/ipc-channels.js'
import type { LlmProvider, SttProvider } from '../../shared/types.js'
import { testProviderConnection, testSttConnection } from '../providers/testConnection.js'
import { handleIpc } from './guard.js'

export function registerProvidersHandlers(): void {
  handleIpc(IPC.providers.testConnection, (_e, id: LlmProvider) => testProviderConnection(id))
  handleIpc(IPC.providers.testStt, (_e, id: SttProvider) => testSttConnection(id))
}
