import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels.js'
import { ask as aiAsk, stop as aiStop } from '../ai/aiGatewayClient.js'
import { suggestFollowUps } from '../ai/llm/followUpLlm.js'
import { catalogLanguageModels, refreshGatewayCatalog } from '../ai/gatewayCatalog.js'
import { handleIpc } from './guard.js'
import { aiAskInputSchema, aiFollowUpsInputSchema } from './schemas.js'

export function registerAiHandlers(): void {
  handleIpc(IPC.ai.ask, (_e, input: unknown) => aiAsk(aiAskInputSchema.parse(input)))
  // Abort an in-flight ask() by id. Renderer's Stop button calls this; main
  // finalizes the partial answer cleanly (no error).
  handleIpc(IPC.ai.stop, (_e, requestId: unknown) => aiStop(z.string().parse(requestId)))
  // Suggest up to 3 short follow-up questions for a completed Q+A turn. Used
  // for the clickable follow-up chips under a finished answer.
  handleIpc(IPC.ai.followUps, (_e, input: unknown) => {
    const { question, answer } = aiFollowUpsInputSchema.parse(input)
    return suggestFollowUps(question, answer)
  })
  handleIpc(IPC.ai.gatewayModels, async () => {
    await refreshGatewayCatalog()
    return catalogLanguageModels()?.map((m) => m.id) ?? null
  })
}
