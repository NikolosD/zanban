import type { LlmFinishReason } from '../types.js'

/**
 * Map a provider's native finish/stop reason onto our normalized
 * `LlmFinishReason`. Covers the conventions used across the SDKs we support:
 *   - OpenAI / Groq chat completions: 'stop' | 'length' | 'content_filter' | 'tool_calls'
 *   - Anthropic:                      'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'
 *   - Gemini:                         'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | …
 *   - Ollama (NDJSON `done_reason`):  'stop' | 'length' | 'load'
 *
 * Returns `undefined` for a missing/unknown raw value so callers can decide
 * whether to surface "other" or simply omit the reason.
 */
export function normalizeFinishReason(raw: string | null | undefined): LlmFinishReason | undefined {
  if (!raw) return undefined
  const v = raw.toLowerCase()
  // Length / token-cap truncation — the case the "Continue" affordance needs.
  if (v === 'length' || v === 'max_tokens' || v === 'maxtokens') return 'length'
  // Natural completion.
  if (v === 'stop' || v === 'end_turn' || v === 'stop_sequence' || v === 'endofturn') return 'stop'
  // Content / safety stops.
  if (v === 'content_filter' || v === 'safety' || v === 'recitation' || v === 'blocklist')
    return 'content'
  return 'other'
}
