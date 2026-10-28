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
})
