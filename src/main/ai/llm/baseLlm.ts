import { createGateway } from '@ai-sdk/gateway'
import { generateText } from 'ai'
import type { AiRole } from '../../../shared/types.js'
import { getSettings } from '../../settings.js'
import { modelFor } from '../models.js'
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

function gateway() {
  const settings = getSettings()
  if (!settings.vercelApiKey) {
    throw new Error('Vercel AI Gateway key not configured. Open Settings.')
  }
  return createGateway({ apiKey: settings.vercelApiKey })
}

/**
 * Run a non-streaming completion. Used by the small helper LLMs (intent
 * classification, clarify, follow-ups, question extraction) that don't need
 * to stream — token counts are tiny so latency is bounded by TTFT + a couple
 * of dozen tokens.
 *
 * Routes through whichever LLM provider the user picked in Settings. If the
 * alt provider fails, falls back to Vercel Gateway so the helper doesn't
 * silently die when e.g. Ollama isn't running.
 */
export async function generateOneShot(args: OneShotArgs): Promise<string> {
  const altProvider = getActiveLlmProvider()
  if (altProvider) {
    // Honor the user's provider pick — no silent fallback. If Gemini is
    // selected and broken, we want the error visible (in console + the UI)
    // rather than transparently bleeding requests onto Vercel Gateway.
    return altProvider.generate({
      model: modelFor(args.role),
      system: args.system,
      prompt: args.prompt,
      temperature: args.temperature ?? 0.2,
      maxOutputTokens: args.maxOutputTokens ?? 200,
      signal: args.signal
    })
  }
  const gw = gateway()
  const result = await generateText({
    model: gw(modelFor(args.role)),
    system: args.system,
    prompt: args.prompt,
    temperature: args.temperature ?? 0.2,
    maxOutputTokens: args.maxOutputTokens ?? 200,
    abortSignal: args.signal
  })
  return result.text.trim()
}
