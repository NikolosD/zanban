import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../settings.js', () => ({ getSettings: () => ({ ollamaHost: null }) }))

const { pullModel } = await import('./ollamaManager.js')

const line = (event: object) => `${JSON.stringify(event)}\n`

function respondWith(chunks: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  const fetchMock = vi.fn(async () => new Response(body))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('pullModel', () => {
  it('sums the layers and reports each whole percent once', async () => {
    const stream = [
      line({ status: 'pulling manifest' }),
      line({ status: 'pulling a', digest: 'a', total: 900, completed: 0 }),
      line({ status: 'pulling a', digest: 'a', total: 900, completed: 450 }),
      line({ status: 'pulling a', digest: 'a', total: 900, completed: 451 }),
      line({ status: 'pulling b', digest: 'b', total: 100, completed: 100 }),
      line({ status: 'pulling a', digest: 'a', total: 900, completed: 900 }),
      line({ status: 'verifying sha256 digest' }),
      line({ status: 'success' })
    ].join('')
    // Chunk borders fall inside lines, as they do over the network.
    const fetchMock = respondWith([stream.slice(0, 50), stream.slice(50, 133), stream.slice(133)])
    const progress: Array<[number, number]> = []

    const ok = await pullModel('qwen3.5:9b', (done, total) => progress.push([done, total]))

    expect(ok).toBe(true)
    expect(progress).toEqual([
      [0, 900],
      [450, 900],
      [551, 1000],
      [1000, 1000]
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/pull',
      expect.objectContaining({ body: JSON.stringify({ model: 'qwen3.5:9b' }) })
    )
  })

  it('fails on an error line, which Ollama sends with a 200', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    respondWith([line({ error: 'pull model manifest: file does not exist' })])
    expect(await pullModel('nope', () => {})).toBe(false)
  })

  it('fails when the stream ends before Ollama reports success', async () => {
    respondWith([line({ status: 'pulling a', digest: 'a', total: 10, completed: 5 })])
    expect(await pullModel('qwen3.5:9b', () => {})).toBe(false)
  })
})
