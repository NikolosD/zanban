import type { AppSettings, LlmProvider } from '@shared/types'
import type { ProviderDotStatus } from '@renderer/components/ProviderStatusDot'

interface OllamaHealthLike {
  running: boolean
}

/**
 * Map a provider id + current settings to a status dot color. Cloud providers
 * report `ok` once their key is present; Ollama uses the live health probe
 * from the parent so the dot can flip red when the daemon is offline.
 *
 * `vercel-gateway` is treated like any cloud provider — it gates the legacy
 * gateway path and the answer to "is this configured?" is just "do we have
 * the key?".
 */
export function llmProviderStatus(
  id: LlmProvider,
  settings: AppSettings,
  ollama: OllamaHealthLike | null
): ProviderDotStatus {
  switch (id) {
    case 'vercel-gateway':
      return settings.vercelApiKey ? 'ok' : 'missing'
    case 'anthropic':
      return settings.anthropicApiKey ? 'ok' : 'missing'
    case 'openai':
      return settings.openaiApiKey ? 'ok' : 'missing'
    case 'google-gemini':
      return settings.googleAiApiKey ? 'ok' : 'missing'
    case 'groq':
      return settings.groqApiKey ? 'ok' : 'missing'
    case 'ollama':
      // Ollama doesn't need an API key — the right question is "is the
      // local daemon reachable on the configured host?". `ollama` is null
      // when the live probe hasn't completed yet, so default to unknown
      // rather than "missing" (which implies user action is required).
      if (!ollama) return 'unknown'
      return ollama.running ? 'ok' : 'error'
  }
}
