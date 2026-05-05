import { getSettings } from '../settings.js'
import type { LlmProvider } from '../../shared/types.js'
import type { ILlmProvider, IWebSearchProvider } from './types.js'
import { makeAnthropicProvider } from './llm/anthropic.js'
import { makeOpenAiProvider } from './llm/openai.js'
import { makeGroqProvider } from './llm/groq.js'
import { makeGeminiProvider } from './llm/gemini.js'
import { makeOllamaProvider } from './llm/ollama.js'
import { makeTavilyProvider } from './webSearch/tavily.js'

/**
 * Resolve the active LLM provider based on user settings. The legacy
 * Vercel-AI-Gateway path remains the default — the new providers kick in
 * only when the user explicitly switches in Settings.
 *
 * Returns null when the selected provider is missing its API key — callers
 * should fall back to the gateway flow.
 */
export function getActiveLlmProvider(): ILlmProvider | null {
  return resolveProvider(getSettings().llmProvider ?? 'vercel-gateway')
}

/**
 * Vision-only override. When the user has set `visionProvider` in Settings,
 * image-bearing requests route through that provider instead of the main LLM.
 * Falls back to the main provider when the override is null or missing its key.
 */
export function getActiveVisionProvider(): ILlmProvider | null {
  const s = getSettings()
  if (!s.visionProvider) return getActiveLlmProvider()
  const overridden = resolveProvider(s.visionProvider)
  // If the override pointed to a provider with no key, don't silently fall
  // back to the main provider — that would re-introduce the bug the override
  // was meant to fix. Caller can detect null and surface a clear error.
  return overridden
}

function resolveProvider(id: LlmProvider): ILlmProvider | null {
  const s = getSettings()
  switch (id) {
    case 'anthropic':
      return s.anthropicApiKey ? makeAnthropicProvider(s.anthropicApiKey) : null
    case 'openai':
      return s.openaiApiKey ? makeOpenAiProvider(s.openaiApiKey) : null
    case 'groq':
      return s.groqApiKey ? makeGroqProvider(s.groqApiKey) : null
    case 'google-gemini':
      return s.googleAiApiKey ? makeGeminiProvider(s.googleAiApiKey) : null
    case 'ollama':
      return makeOllamaProvider(s.ollamaHost || undefined)
    case 'vercel-gateway':
      // The gateway path lives in aiGatewayClient; returning null here tells
      // the caller "use the legacy path" — keeping things explicit.
      return null
    default:
      return null
  }
}

export function getActiveWebSearch(): IWebSearchProvider | null {
  const s = getSettings()
  return s.tavilyApiKey ? makeTavilyProvider(s.tavilyApiKey) : null
}
