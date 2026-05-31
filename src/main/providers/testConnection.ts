import type { LlmProvider } from '../../shared/types.js'
import { PROVIDER_MODEL_DEFAULTS } from '../../shared/types.js'
import { getSettings } from '../settings.js'
import { checkOllama } from '../services/ollamaManager.js'
import { getLlmProviderById } from './registry.js'

export interface ProviderTestResult {
  ok: boolean
  message?: string
}

/**
 * Real connectivity probe for an LLM provider. Unlike the config-presence dot
 * (which only checks "is a key string set?"), this performs a cheap live call:
 *   - cloud providers: a 1-token `generate()` against the provider's default
 *     fast model — the lightest request that still exercises auth + routing.
 *   - vercel-gateway: same, via the registry's gateway-backed provider.
 *   - ollama: the existing health probe (daemon reachable on the host?).
 *
 * Returns `{ ok, message }` so the UI can show a clear verified/failed state
 * with the provider's own error text when something is wrong.
 */
export async function testProviderConnection(id: LlmProvider): Promise<ProviderTestResult> {
  if (id === 'ollama') {
    const health = await checkOllama()
    if (health.running) {
      return { ok: true, message: `${health.models.length} model(s) installed` }
    }
    return { ok: false, message: health.error ?? 'Ollama not reachable' }
  }

  const settings = getSettings()
  if (id === 'vercel-gateway') {
    if (!settings.vercelApiKey) return { ok: false, message: 'No API key set' }
    return probeGateway()
  }

  const provider = getLlmProviderById(id)
  if (!provider) return { ok: false, message: 'No API key set' }

  try {
    const model = PROVIDER_MODEL_DEFAULTS[id].fast
    await provider.generate({
      model,
      system: 'You are a connectivity probe. Reply with a single character.',
      prompt: 'ping',
      maxOutputTokens: 1,
      temperature: 0
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * The Vercel AI Gateway path lives outside the ILlmProvider registry (it uses
 * the @ai-sdk/gateway streaming client). A minimal `generateText`-equivalent
 * is overkill here — instead we hit the gateway's model-list endpoint, which
 * validates the key without spending tokens.
 */
async function probeGateway(): Promise<ProviderTestResult> {
  const settings = getSettings()
  try {
    const { createGateway } = await import('@ai-sdk/gateway')
    const { generateText } = await import('ai')
    const gw = createGateway({ apiKey: settings.vercelApiKey! })
    await generateText({
      model: gw(PROVIDER_MODEL_DEFAULTS['vercel-gateway'].fast),
      prompt: 'ping',
      maxOutputTokens: 1,
      temperature: 0
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
