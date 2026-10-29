import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmStreamArgs } from '../types.js'

const sdk = vi.hoisted(() => ({
  parts: [] as Array<Record<string, unknown>>,
  request: undefined as Record<string, unknown> | undefined
}))
vi.mock('@ai-sdk/gateway', () => ({ createGateway: () => (id: string) => ({ modelId: id }) }))
vi.mock('ai', () => ({
  streamText: (request: Record<string, unknown>) => {
    sdk.request = request
    return {
      fullStream: (async function* () {
        yield* sdk.parts
      })()
    }
  }
}))

const { gatewayCallOptions, makeGatewayProvider } = await import('./gateway.js')
const { setGatewayCatalogForTest } = await import('../../ai/gatewayCatalog.js')

async function drain(args: Partial<LlmStreamArgs>) {
  const stream = makeGatewayProvider('vck_x').stream({
    model: 'openai/gpt-6.1-terra',
    system: 's',
    prompt: 'p',
    ...args
  })
  const text: string[] = []
  let next = await stream.next()
  while (!next.done) {
    text.push(next.value)
    next = await stream.next()
  }
  return { text, finishReason: next.value }
}

describe('gateway provider', () => {
  beforeEach(() => setGatewayCatalogForTest([]))

  it('streams the text with per-model options and reports the finish reason', async () => {
    sdk.parts = [
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'finish', finishReason: 'length' }
    ]
    expect(await drain({ temperature: 0.4 })).toEqual({
      text: ['Hel', 'lo'],
      finishReason: 'length'
    })
    expect(sdk.request).toMatchObject({
      prompt: 'p',
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'none' } }
    })
  })

  it('throws the error the stream reports instead of ending empty', async () => {
    sdk.parts = [{ type: 'error', error: new Error('Invalid API key') }]
    await expect(drain({})).rejects.toThrow('Invalid API key')
  })

  it('sends a screenshot as an image part', async () => {
    sdk.parts = [{ type: 'finish', finishReason: 'stop' }]
    await drain({ imageDataUrl: 'data:image/png;base64,AAAA' })
    expect(sdk.request).not.toHaveProperty('prompt')
    expect(sdk.request?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'p' },
          { type: 'image', image: 'data:image/png;base64,AAAA' }
        ]
      }
    ])
  })
})

describe('gatewayCallOptions', () => {
  beforeEach(() => {
    setGatewayCatalogForTest([
      {
        id: 'openai/gpt-6.1-terra',
        temperature: true,
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium'] }]
      },
      {
        id: 'anthropic/claude-haiku-5.5',
        temperature: false,
        reasoning_options: [{ type: 'effort', values: ['none', 'low'] }]
      },
      {
        id: 'anthropic/claude-sonnet-5.5',
        temperature: false,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium'] }]
      },
      { id: 'xiaomi/mimo-v2.6-flash', temperature: true }
    ])
  })

  it('turns reasoning off where the model allows it', () => {
    expect(gatewayCallOptions('openai/gpt-6.1-terra', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'none' } }
    })
    expect(gatewayCallOptions('anthropic/claude-haiku-5.5', 0.4)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
    })
  })

  it('falls back to the lowest effort and drops a temperature the model rejects', () => {
    expect(gatewayCallOptions('anthropic/claude-sonnet-5.5', 0.3)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { effort: 'low' } }
    })
    expect(gatewayCallOptions('xiaomi/mimo-v2.6-flash', 0.3)).toEqual({
      temperature: 0.3,
      providerOptions: undefined
    })
  })

  it('sets up the default models right before the catalog has loaded', () => {
    setGatewayCatalogForTest(null)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    expect(gatewayCallOptions('openai/gpt-6.1-terra', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'none' } }
    })
    expect(gatewayCallOptions('anthropic/claude-haiku-5.5', 0.4)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
    })
    expect(gatewayCallOptions('openai/gpt-oss-120b', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'low' } }
    })
    vi.unstubAllGlobals()
  })
})
