import { describe, it, expect, vi } from 'vitest'
import { streamWithFallback, type FallbackStreamEvent } from './fallbackChain.js'
import type { ILlmProvider } from '../../providers/types.js'

function makeProvider(
  id: string,
  behaviour:
    | { kind: 'chunks'; chunks: string[] }
    | { kind: 'throw-before'; error: Error }
    | { kind: 'throw-after'; chunks: string[]; error: Error }
): ILlmProvider {
  const stream = vi.fn(async function* () {
    if (behaviour.kind === 'throw-before') {
      throw behaviour.error
    }
    for (const chunk of behaviour.chunks) {
      yield chunk
    }
    if (behaviour.kind === 'throw-after') {
      throw behaviour.error
    }
  })
  // The actual ILlmProvider type wants generate() too. Tests don't use it.
  return {
    id: id as ILlmProvider['id'],
    label: id,
    stream,
    generate: async () => ''
  }
}

const ARGS = { model: 'm', system: 's', prompt: 'p' }

async function collect(gen: AsyncGenerator<FallbackStreamEvent>): Promise<FallbackStreamEvent[]> {
  const out: FallbackStreamEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('streamWithFallback', () => {
  it('streams from the primary when it succeeds', async () => {
    const primary = makeProvider('anthropic', { kind: 'chunks', chunks: ['hi ', 'there'] })
    const events = await collect(streamWithFallback([primary], ARGS))
    expect(events).toEqual([
      { kind: 'chunk', text: 'hi ', providerId: 'anthropic' },
      { kind: 'chunk', text: 'there', providerId: 'anthropic' }
    ])
  })

  it('falls back when the primary throws before emitting', async () => {
    const primary = makeProvider('anthropic', {
      kind: 'throw-before',
      error: new Error('429 rate limited')
    })
    const secondary = makeProvider('openai', { kind: 'chunks', chunks: ['ok'] })
    const events = await collect(streamWithFallback([primary, secondary], ARGS))
    expect(events).toEqual([
      {
        kind: 'fallback',
        fromProviderId: 'anthropic',
        toProviderId: 'openai',
        reason: '429 rate limited'
      },
      { kind: 'chunk', text: 'ok', providerId: 'openai' }
    ])
  })

  it('skips through multiple failing providers until one streams', async () => {
    const a = makeProvider('anthropic', {
      kind: 'throw-before',
      error: new Error('a-failed')
    })
    const b = makeProvider('openai', {
      kind: 'throw-before',
      error: new Error('b-failed')
    })
    const c = makeProvider('groq', { kind: 'chunks', chunks: ['c'] })
    const events = await collect(streamWithFallback([a, b, c], ARGS))
    expect(events.filter((e) => e.kind === 'fallback')).toHaveLength(2)
    expect(events.filter((e) => e.kind === 'chunk')).toEqual([
      { kind: 'chunk', text: 'c', providerId: 'groq' }
    ])
  })

  it('throws the original error when every provider fails', async () => {
    const a = makeProvider('anthropic', {
      kind: 'throw-before',
      error: new Error('a-failed')
    })
    const b = makeProvider('openai', {
      kind: 'throw-before',
      error: new Error('b-failed')
    })
    await expect(collect(streamWithFallback([a, b], ARGS))).rejects.toThrow('b-failed')
  })

  it('does not switch providers once chunks have been emitted', async () => {
    const primary = makeProvider('anthropic', {
      kind: 'throw-after',
      chunks: ['partial'],
      error: new Error('mid-stream-disconnect')
    })
    const secondary = makeProvider('openai', { kind: 'chunks', chunks: ['unused'] })
    await expect(
      (async () => {
        for await (const _ of streamWithFallback([primary, secondary], ARGS)) void _
      })()
    ).rejects.toThrow('mid-stream-disconnect')
    // Secondary must never have been invoked once we committed to the primary.
    expect(secondary.stream).not.toHaveBeenCalled()
  })

  it('throws when the provider list is empty', async () => {
    await expect(collect(streamWithFallback([], ARGS))).rejects.toThrow('no providers supplied')
  })
})
