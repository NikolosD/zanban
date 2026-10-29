import { IPC } from '../../shared/ipc-channels.js'
import { checkOllama, pullModel } from '../services/ollamaManager.js'
import { handleIpc } from './guard.js'

export function registerOllamaHandlers(): void {
  handleIpc(IPC.ollama.health, () => checkOllama())
  handleIpc(IPC.ollama.pull, (e, name: string) =>
    pullModel(name, (completed, total) => {
      if (!e.sender.isDestroyed()) {
        e.sender.send(IPC.ollama.pullProgress, { name, completed, total })
      }
    })
  )
}
