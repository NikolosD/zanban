/**
 * Cross-cutting shapes for the provider abstraction layer. Each provider
 * (LLM / STT / embeddings / web search) implements a small interface so the
 * rest of the app can swap them at runtime via the registry.
 */

import type { LlmProvider } from '../../shared/types.js'

export type WebSearchProviderId = 'tavily'

export interface LlmStreamArgs {
  model: string
  system: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  imageDataUrl?: string
  signal?: AbortSignal
}

export interface ILlmProvider {
  readonly id: LlmProvider
  readonly label: string
  /** Stream textual chunks for `args.prompt`. The async iterable yields raw
   *  text deltas; consumers are responsible for accumulating. */
  stream(args: LlmStreamArgs): AsyncIterable<string>
  /** One-shot non-stream completion. */
  generate(args: LlmStreamArgs): Promise<string>
}

export interface IWebSearchProvider {
  readonly id: WebSearchProviderId
  search(query: string, opts?: { topK?: number }): Promise<Array<{ title: string; url: string; snippet: string }>>
}

export interface ProviderHealth {
  ok: boolean
  message?: string
}
