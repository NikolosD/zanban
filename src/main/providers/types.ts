/**
 * Cross-cutting shapes for the provider abstraction layer. Each provider
 * (LLM / STT / embeddings / web search) implements a small interface so the
 * rest of the app can swap them at runtime via the registry.
 */

import type { LlmProvider } from '../../shared/types.js'

export type WebSearchProviderId = 'tavily'

/**
 * Normalized stream-finish reason. Each provider maps its SDK's native
 * finish/stop reason onto this small set so the renderer can flag a
 * length-truncation (model hit `maxOutputTokens` and stopped mid-thought)
 * consistently, regardless of which provider answered.
 *   - 'stop'    — model finished naturally
 *   - 'length'  — output was cut at the token cap (offer "Continue")
 *   - 'content' — content filter / safety stop
 *   - 'other'   — anything else / unmapped
 */
export type LlmFinishReason = 'stop' | 'length' | 'content' | 'other'

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
  /** Stream textual chunks for `args.prompt`. The async generator yields raw
   *  text deltas (consumers accumulate) and *returns* the normalized finish
   *  reason once the stream completes — `undefined` when the provider can't
   *  expose one. */
  stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void>
  /** One-shot non-stream completion. */
  generate(args: LlmStreamArgs): Promise<string>
}

export interface IWebSearchProvider {
  readonly id: WebSearchProviderId
  search(
    query: string,
    opts?: { topK?: number }
  ): Promise<Array<{ title: string; url: string; snippet: string }>>
}

export interface ProviderHealth {
  ok: boolean
  message?: string
}
