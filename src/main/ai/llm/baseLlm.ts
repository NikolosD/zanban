import type { AiRole } from '../../../shared/types.js'
import { availableModel, modelFor } from '../models.js'
import { getActiveLlmProvider } from '../../providers/registry.js'

export interface OneShotArgs {
  /** Which role's model to use. Persona overrides aren't applied here — these
   *  are background helper LLMs, not the main answer stream. */
  role: AiRole
  system: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  signal?: AbortSignal
}

/**
 * Run a non-streaming completion. Used by the small helper LLMs (follow-up
 * suggestions, recap generation) that don't need to stream — token counts are
 * tiny so latency is bounded by TTFT + a couple of dozen tokens.
 *
 * Routes through whichever LLM provider the user picked in Settings, with no
 * fallback: if Gemini is selected and broken, the error stays visible instead
 * of requests quietly moving to another vendor.
 */
export async function generateOneShot(args: OneShotArgs): Promise<string> {
  const provider = getActiveLlmProvider()
  if (!provider) throw new Error('The AI provider has no API key. Open Settings → AI Provider.')
  return provider.generate({
    model: availableModel(provider.id, modelFor(args.role, provider.id), args.role),
    system: args.system,
    prompt: args.prompt,
    temperature: args.temperature ?? 0.2,
    maxOutputTokens: args.maxOutputTokens ?? 200,
    signal: args.signal
  })
}
