import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeAnthropicProvider } from './anthropic.js'

// Load the real SDK up front so a slow first import on a busy CI runner isn't
// billed to one test's 5 s timeout.
await import('@anthropic-ai/sdk')

// The real SDK, with only the network stubbed: what is asserted is the JSON the
// SDK puts on the wire.
function sse(): Response {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 }
    },
    { type: 'message_stop' }
  ]
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const message = (): Response =>
  new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

let keys = 0

function wire(respond: () => Response) {
  const fetchMock = vi.fn(async (_url: unknown, _init: unknown) => respond())
  vi.stubGlobal('fetch', fetchMock)
  return {
    provider: makeAnthropicProvider(`sk-ant-${keys++}`),
    body: () =>
      JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
        system: unknown
        messages: Array<{ role: string; content: unknown }>
      }
  }
}

const args = {
  model: 'claude-haiku-5-5',
  system: 'You are Zanban.\n\nWho the user is (persona):\nA staff engineer.',
  prompt: '<recent_transcript>\n[Them] hi\n</recent_transcript>'
}

afterEach(() => vi.unstubAllGlobals())

describe('Anthropic prompt caching', () => {
  it('closes the system prompt with a breakpoint on an answer and marks nothing else', async () => {
    const { provider, body } = wire(sse)
    for await (const chunk of provider.stream(args)) void chunk

    expect(body().system).toEqual([
      { type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }
    ])
    expect(body().messages).toEqual([{ role: 'user', content: args.prompt }])
    expect(JSON.stringify(body()).match(/cache_control/g)).toHaveLength(1)
  })

  it('does the same for a screenshot, whose image is not marked', async () => {
    const { provider, body } = wire(sse)
    const imageDataUrl = 'data:image/png;base64,AAAA'
    for await (const chunk of provider.stream({ ...args, imageDataUrl })) void chunk

    expect(body().system).toEqual([
      { type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }
    ])
    expect(body().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: args.prompt }
        ]
      }
    ])
  })

  it('sends a one-shot completion as it did, with the system prompt as plain text', async () => {
    const { provider, body } = wire(message)
    expect(await provider.generate(args)).toBe('ok')

    expect(body().system).toBe(args.system)
    expect(JSON.stringify(body())).not.toContain('cache_control')
  })
})
