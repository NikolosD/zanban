import { IPC } from '../../shared/ipc-channels.js'
import { checkOllama, pullModel } from '../services/ollamaManager.js'
import { handleIpc } from './guard.js'

export function registerOllamaHandlers(): void {
  handleIpc(IPC.ollama.health, () => checkOllama())
  handleIpc(IPC.ollama.pull, (_e, name: string) => pullModel(name))
}
