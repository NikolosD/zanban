import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  ask as aiAsk,
  extractQuestion as aiExtractQuestion
} from '../ai/aiGatewayClient.js'

export function registerAiHandlers(): void {
  ipcMain.handle(
    IPC.ai.ask,
    (
      _e,
      input: {
        prompt: string
        contextSeconds?: number
        imageDataUrl?: string
        ocrText?: string
        modelOverride?: string
      }
    ) => aiAsk(input)
  )
  ipcMain.handle(IPC.ai.extractQuestion, (_e, text: string) => aiExtractQuestion(text))
}
