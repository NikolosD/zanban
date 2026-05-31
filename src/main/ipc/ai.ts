import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { ask as aiAsk, stop as aiStop } from '../ai/aiGatewayClient.js'
import { suggestFollowUps } from '../ai/llm/followUpLlm.js'

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
  // Abort an in-flight ask() by id. Renderer's Stop button calls this; main
  // finalizes the partial answer cleanly (no error).
  ipcMain.handle(IPC.ai.stop, (_e, requestId: string) => aiStop(requestId))
  // Suggest up to 3 short follow-up questions for a completed Q+A turn. Used
  // for the clickable follow-up chips under a finished answer.
  ipcMain.handle(IPC.ai.followUps, (_e, input: { question: string; answer: string }) =>
    suggestFollowUps(input.question, input.answer)
  )
}
