import { afterEach, describe, expect, it, vi } from 'vitest'

// Real `ai` and `@ai-sdk/gateway`: what the gateway receives is whatever these
// versions serialize, and the cache breakpoint rides in that request.
const { makeGatewayProvider } = await import('./gateway.js')
const { setGatewayCatalogForTest } = await import('../../ai/gatewayCatalog.js')

afterEach(() => vi.unstubAllGlobals())

async function sentToGateway(model: string): Promise<{ prompt: Array<Record<string, unknown>> }> {
  setGatewayCatalogForTest([])
  const fetchMock = vi.fn(
    async (_url: unknown, _init: unknown) =>
      new Response(JSON.stringify({ error: { message: 'stop here', type: 'invalid_request' } }), {
        status: 400
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  const stream = makeGatewayProvider(`vck_${model}`).stream({
    model,
    system: 'SYS',
    prompt: 'P',
    maxOutputTokens: 100
  })
  await expect(stream.next()).rejects.toThrow()
  const [url, init] = fetchMock.mock.calls[0]!
  expect(String(url)).toMatch(/\/language-model$/)
  return JSON.parse((init as { body: string }).body)
}

describe('request to the AI Gateway', () => {
  it('carries the breakpoint on the system message of an Anthropic model', async () => {
    const body = await sentToGateway('anthropic/claude-haiku-5.5')
    expect(body.prompt[0]).toEqual({
      role: 'system',
      content: 'SYS',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
    })
    expect(body.prompt[1]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'P' }] })
    expect(JSON.stringify(body.prompt[1])).not.toContain('cacheControl')
  })

  it('carries no breakpoint for a model from another creator', async () => {
    const body = await sentToGateway('openai/gpt-6.1-terra')
    expect(body.prompt[0]).toEqual({ role: 'system', content: 'SYS' })
  })
})
