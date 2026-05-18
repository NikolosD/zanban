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

/**
 * Does the *active* LLM provider have the credentials it needs? Each provider
 * keys off a different settings field — Ollama is local and needs none. This
 * is the key-presence question only; daemon reachability is handled by
 * `llmProviderStatus`.
 */
export function llmProviderConfigured(settings: AppSettings): boolean {
  switch (settings.llmProvider) {
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
      return true
  }
}

/**
 * Does the *active* STT provider have the credentials it needs? Mirrors
 * `llmProviderConfigured` for the speech-to-text side — local Whisper runs
 * on-device and needs no key.
 */
export function sttProviderConfigured(settings: AppSettings): boolean {
  switch (settings.sttProvider) {
    case 'google':
      return !!settings.googleProjectId
    case 'deepgram':
      return !!settings.deepgramApiKey
    case 'elevenlabs':
      return !!settings.elevenlabsApiKey
    case 'openai-whisper':
      return !!settings.openaiApiKey
    case 'local-whisper':
      return true
  }
}
