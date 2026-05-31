import type { AppSettings, LlmProvider } from '@shared/types'

/**
 * Preferred ordering for the auto-filled fallback chain. Cloud aggregator
 * first (broadest model coverage on one key), then strong direct vendors,
 * with the local Ollama daemon last (only useful when it's actually running).
 */
const PREFERENCE: LlmProvider[] = [
  'vercel-gateway',
  'anthropic',
  'openai',
  'google-gemini',
  'groq',
  'ollama'
]

/** True when the given provider currently has the credentials it needs. */
export function providerHasKey(id: LlmProvider, settings: AppSettings): boolean {
  switch (id) {
    case 'vercel-gateway':
      return !!settings.vercelApiKey
    case 'anthropic':
      return !!settings.anthropicApiKey
    case 'openai':
      return !!settings.openaiApiKey
    case 'google-gemini':
      return !!settings.googleAiApiKey
    case 'groq':
      return !!settings.groqApiKey
    case 'ollama':
      // Ollama needs no API key — it's "configured" whenever a host is set or
      // the default localhost is used. We always treat it as a candidate; the
      // runtime fallback skips it if the daemon is unreachable.
      return true
  }
}

/**
 * Build a sensible fallback order from the providers that currently have a
 * non-empty key, in PREFERENCE order, excluding the active provider (it's the
 * primary — the chain only kicks in once *it* has failed). Pure so it can be
 * unit-tested without the renderer.
 */
export function autoFallbackOrder(settings: AppSettings): LlmProvider[] {
  const active = settings.llmProvider
  return PREFERENCE.filter((id) => id !== active && providerHasKey(id, settings))
}
