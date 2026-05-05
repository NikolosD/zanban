import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { checkOllama, pullModel } from '../services/ollamaManager.js'

export function registerOllamaHandlers(): void {
  ipcMain.handle(IPC.ollama.health, () => checkOllama())
  ipcMain.handle(IPC.ollama.pull, (_e, name: string) => pullModel(name))
}
