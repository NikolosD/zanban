import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../../providers/types.js'

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

export interface FallbackAttempt {
  provider: ILlmProvider
  /** Each vendor names its models its own way, so every provider gets its own. */
  model: string
}

/**
 * Iterate `attempts` in order. The first provider streams normally. If a
 * provider throws or answers with nothing **before emitting any chunks** we
 * move to the next one, yielding a `fallback` event so the caller can log the
 * transition. Once a provider has emitted at least one chunk the chain locks
 * in — a later error bubbles up unchanged because rerouting would replace
 * partially-rendered text with a different answer (worse UX than a clean error).
 *
 * Returns the normalized finish reason of the provider that completed (or
 * `undefined` when the provider couldn't expose one) so the caller can flag a
 * length-truncation regardless of which provider answered.
 *
 * Throws if every provider fails, with the last error preserved.
 */
export async function* streamWithFallback(
  attempts: ReadonlyArray<FallbackAttempt>,
  args: Omit<LlmStreamArgs, 'model'>
): AsyncGenerator<FallbackStreamEvent, LlmFinishReason | undefined, void> {
  if (attempts.length === 0) {
    throw new Error('streamWithFallback: no providers supplied')
  }

  let lastError: unknown = null

  for (let i = 0; i < attempts.length; i++) {
    const { provider, model } = attempts[i]!
    let emittedAny = false
    try {
      // The provider's stream *returns* its finish reason; capture it from the
      // generator's done-value rather than the for-await loop (which only sees
      // yielded text deltas).
      const it = provider.stream({ ...args, model })
      let res = await it.next()
      while (!res.done) {
        const text = res.value
        if (text) {
          emittedAny = true
          yield { kind: 'chunk', text, providerId: provider.id }
        }
        res = await it.next()
      }
      if (!emittedAny && !args.signal?.aborted) {
        throw new Error(
          `The model returned an empty answer (finish reason: ${res.value ?? 'unknown'}). Try again or pick another model.`
        )
      }
      return res.value
    } catch (err) {
      lastError = err
      const reason = err instanceof Error ? err.message : String(err)

      // Mid-stream failure — bubble up. Switching providers now would
      // overwrite the user's partial answer with something inconsistent.
      // An aborted request (Stop / idle timeout) must not fall back either.
      if (emittedAny || args.signal?.aborted) {
        throw err
      }

      const next = attempts[i + 1]
      if (!next) {
        // No fallbacks left — propagate the original error.
        throw err
      }

      yield {
        kind: 'fallback',
        fromProviderId: provider.id,
        toProviderId: next.provider.id,
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
