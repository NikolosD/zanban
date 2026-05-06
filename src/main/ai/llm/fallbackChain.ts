import type { ILlmProvider, LlmStreamArgs } from '../../providers/types.js'

/**
 * Stream events emitted by `streamWithFallback`. `chunk` events carry the
 * provider's text deltas; `fallback` events tell the consumer that a provider
 * failed before emitting anything and we're moving to the next one. The
 * caller decides whether to surface fallback events to the user — by default
 * we just log them, since users care about the answer, not the plumbing.
 */
export type FallbackStreamEvent =
  | { kind: 'chunk'; text: string; providerId: string }
  | { kind: 'fallback'; fromProviderId: string; toProviderId: string; reason: string }

/**
 * Iterate `providers` in order. The first provider streams normally. If a
 * provider throws **before emitting any chunks** we move to the next one,
 * yielding a `fallback` event so the caller can log the transition. Once a
 * provider has emitted at least one chunk the chain locks in — a later error
 * bubbles up unchanged because rerouting would replace partially-rendered
 * text with a different answer (worse UX than a clean error).
 *
 * Throws if every provider fails, with the last error preserved.
 */
export async function* streamWithFallback(
  providers: ReadonlyArray<ILlmProvider>,
  args: LlmStreamArgs
): AsyncGenerator<FallbackStreamEvent, void, void> {
  if (providers.length === 0) {
    throw new Error('streamWithFallback: no providers supplied')
  }

  let lastError: unknown = null

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!
    let emittedAny = false
    try {
      for await (const text of provider.stream(args)) {
        if (text) {
          emittedAny = true
          yield { kind: 'chunk', text, providerId: provider.id }
        }
      }
      // Stream completed without errors.
      return
    } catch (err) {
      lastError = err
      const reason = err instanceof Error ? err.message : String(err)

      if (emittedAny) {
        // Mid-stream failure — bubble up. Switching providers now would
        // overwrite the user's partial answer with something inconsistent.
        throw err
      }

      const next = providers[i + 1]
      if (!next) {
        // No fallbacks left — propagate the original error.
        throw err
      }

      yield {
        kind: 'fallback',
        fromProviderId: provider.id,
        toProviderId: next.id,
        reason
      }
      // Continue to the next provider in the loop.
    }
  }

  // Should be unreachable: either we returned on success, or threw on failure.
  throw lastError instanceof Error
    ? lastError
    : new Error('streamWithFallback: every provider failed')
}
