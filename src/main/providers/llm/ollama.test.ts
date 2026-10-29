import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeOllamaProvider } from './ollama.js'

function ndjson(lines: object[]): Response {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  return new Response(body, { status: 200 })
}

const args = { model: 'llama3.1:8b', system: 's', prompt: 'p' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ollama provider stream', () => {
  it('yields content and returns the normalized finish reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjson([
          { message: { content: 'Hel' } },
          { message: { content: 'lo' } },
          { done: true, done_reason: 'length' }
        ])
      )
    )
    const stream = makeOllamaProvider().stream(args)
    let text = ''
    let res = await stream.next()
    while (!res.done) {
      text += res.value
      res = await stream.next()
    }
    expect(text).toBe('Hello')
    expect(res.value).toBe('length')
  })

  it('turns thinking off only for Qwen3 models', async () => {
    const fetchMock = vi.fn(async () => ndjson([{ done: true, done_reason: 'stop' }]))
    vi.stubGlobal('fetch', fetchMock)
    const sentBody = (): Record<string, unknown> =>
      JSON.parse((fetchMock.mock.lastCall as unknown as [string, { body: string }])[1].body)
    await makeOllamaProvider().generate({ ...args, model: 'qwen3.5:9b' })
    expect(sentBody().think).toBe(false)
    await makeOllamaProvider().generate(args)
    expect(sentBody()).not.toHaveProperty('think')
  })

  it('throws on a mid-stream error line instead of ending silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjson([{ message: { content: 'Hi' } }, { error: 'model runner crashed' }]))
    )
    const chunks: string[] = []
    const consume = async (): Promise<void> => {
      for await (const chunk of makeOllamaProvider().stream(args)) chunks.push(chunk)
    }
    await expect(consume()).rejects.toThrow('Ollama error: model runner crashed')
    expect(chunks).toEqual(['Hi'])
  })

  it('says so when Ollama is not running, or lacks the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    await expect(makeOllamaProvider('http://127.0.0.1:11599').generate(args)).rejects.toMatchObject(
      {
        reason: { kind: 'ollama_unreachable', host: 'http://127.0.0.1:11599' }
      }
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 }))
    )
    await expect(makeOllamaProvider().generate(args)).rejects.toMatchObject({
      reason: { kind: 'ollama_model_missing', model: 'llama3.1:8b' }
    })
  })

  it('lets a Stop through as it is', async () => {
    const stop = new DOMException('This operation was aborted', 'AbortError')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw stop
      })
    )
    await expect(makeOllamaProvider().generate(args)).rejects.toBe(stop)
  })
})
