import { describe, it, expect, vi } from 'vitest'
import { streamWithFallback, type FallbackStreamEvent } from './fallbackChain.js'
import type { ILlmProvider, LlmFinishReason } from '../../providers/types.js'

function makeProvider(
  id: string,
  behaviour:
    | { kind: 'chunks'; chunks: string[]; finishReason?: LlmFinishReason }
    | { kind: 'throw-before'; error: Error }
    | { kind: 'throw-after'; chunks: string[]; error: Error }
): ILlmProvider {
  const stream = vi.fn(async function* (): AsyncGenerator<
    string,
    LlmFinishReason | undefined,
    void
  > {
    if (behaviour.kind === 'throw-before') {
      throw behaviour.error
    }
    for (const chunk of behaviour.chunks) {
      yield chunk
    }
    if (behaviour.kind === 'throw-after') {
      throw behaviour.error
    }
    return behaviour.kind === 'chunks' ? behaviour.finishReason : undefined
  })
  // The actual ILlmProvider type wants generate() too. Tests don't use it.
  return {
    id: id as ILlmProvider['id'],
    label: id,
    stream,
    generate: async () => ''
  }
}

const ARGS = { system: 's', prompt: 'p' }

// Each provider gets its own model id, as the answer path builds them.
function chain(...providers: ILlmProvider[]) {
  return providers.map((provider) => ({ provider, model: `${provider.id}-model` }))
}

async function collect(gen: AsyncGenerator<FallbackStreamEvent>): Promise<FallbackStreamEvent[]> {
  const out: FallbackStreamEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('streamWithFallback', () => {
  it('streams from the primary when it succeeds', async () => {
    const primary = makeProvider('anthropic', { kind: 'chunks', chunks: ['hi ', 'there'] })
    const events = await collect(streamWithFallback(chain(primary), ARGS))
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
    const events = await collect(streamWithFallback(chain(primary, secondary), ARGS))
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
    const events = await collect(streamWithFallback(chain(a, b, c), ARGS))
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
    await expect(collect(streamWithFallback(chain(a, b), ARGS))).rejects.toThrow('b-failed')
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
        for await (const _ of streamWithFallback(chain(primary, secondary), ARGS)) void _
      })()
    ).rejects.toThrow('mid-stream-disconnect')
    // Secondary must never have been invoked once we committed to the primary.
    expect(secondary.stream).not.toHaveBeenCalled()
  })

  it('does not fall back once the request was aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const primary = makeProvider('anthropic', {
      kind: 'throw-before',
      error: new Error('aborted')
    })
    const secondary = makeProvider('openai', { kind: 'chunks', chunks: ['unused'] })
    await expect(
      collect(streamWithFallback(chain(primary, secondary), { ...ARGS, signal: abort.signal }))
    ).rejects.toThrow('aborted')
    expect(secondary.stream).not.toHaveBeenCalled()
  })

  it('throws when the provider list is empty', async () => {
    await expect(collect(streamWithFallback(chain(), ARGS))).rejects.toThrow(
      'no providers supplied'
    )
  })

  it('returns the finish reason of the provider that completed', async () => {
    const primary = makeProvider('anthropic', {
      kind: 'chunks',
      chunks: ['done'],
      finishReason: 'length'
    })
    const gen = streamWithFallback(chain(primary), ARGS)
    let res = await gen.next()
    while (!res.done) res = await gen.next()
    expect(res.value).toBe('length')
  })

  it('returns the finish reason of the fallback provider after a switch', async () => {
    const primary = makeProvider('anthropic', {
      kind: 'throw-before',
      error: new Error('down')
    })
    const secondary = makeProvider('openai', {
      kind: 'chunks',
      chunks: ['ok'],
      finishReason: 'stop'
    })
    const gen = streamWithFallback(chain(primary, secondary), ARGS)
    let res = await gen.next()
    while (!res.done) res = await gen.next()
    expect(res.value).toBe('stop')
  })

  it('gives every provider its own model', async () => {
    const primary = makeProvider('anthropic', { kind: 'throw-before', error: new Error('down') })
    const secondary = makeProvider('openai', { kind: 'chunks', chunks: ['ok'] })
    await collect(streamWithFallback(chain(primary, secondary), ARGS))
    expect(primary.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic-model' })
    )
    expect(secondary.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai-model' })
    )
  })

  it('moves on when a provider answers with nothing', async () => {
    const empty = makeProvider('vercel-gateway', {
      kind: 'chunks',
      chunks: [],
      finishReason: 'content'
    })
    const secondary = makeProvider('openai', { kind: 'chunks', chunks: ['ok'] })
    const events = await collect(streamWithFallback(chain(empty, secondary), ARGS))
    expect(events[0]).toMatchObject({ kind: 'fallback', toProviderId: 'openai' })
    expect(events.at(-1)).toEqual({ kind: 'chunk', text: 'ok', providerId: 'openai' })
    await expect(collect(streamWithFallback(chain(empty), ARGS))).rejects.toThrow(
      'The model returned an empty answer (finish reason: content)'
    )
  })
})
