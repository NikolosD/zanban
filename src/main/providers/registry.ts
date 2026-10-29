import { getSettings } from '../settings.js'
import type { LlmProvider } from '../../shared/types.js'
import type { ILlmProvider, IWebSearchProvider } from './types.js'
import { makeAnthropicProvider } from './llm/anthropic.js'
import { makeOpenAiProvider } from './llm/openai.js'
import { makeGroqProvider } from './llm/groq.js'
import { makeGatewayProvider } from './llm/gateway.js'
import { makeGeminiProvider } from './llm/gemini.js'
import { makeOllamaProvider } from './llm/ollama.js'
import { makeTavilyProvider } from './webSearch/tavily.js'

/**
 * Resolve the active LLM provider based on user settings. Returns null when
 * the selected provider is missing its API key.
 */
export function getActiveLlmProvider(): ILlmProvider | null {
  return resolveProvider(getSettings().llmProvider ?? 'vercel-gateway')
}

/**
 * Resolve a specific provider by id without consulting `settings.llmProvider`.
 * Used by the fallback chain to walk the user-configured fallback list, where
 * each entry is a known provider id and the active selection doesn't matter.
 * Returns null when the provider has no configured key.
 */
export function getLlmProviderById(id: LlmProvider): ILlmProvider | null {
  return resolveProvider(id)
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
      return s.vercelApiKey ? makeGatewayProvider(s.vercelApiKey) : null
    default:
      return null
  }
}

export function getActiveWebSearch(): IWebSearchProvider | null {
  const s = getSettings()
  return s.tavilyApiKey ? makeTavilyProvider(s.tavilyApiKey) : null
}
