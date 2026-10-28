import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTavilyProvider } from './tavily.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tavily provider', () => {
  it('posts the query with the key and maps results to hits', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [{ title: 'T', url: 'https://example.com', content: 'snippet', score: 0.9 }]
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const hits = await makeTavilyProvider('tvly-key').search('what is zanban', { topK: 3 })
    expect(hits).toEqual([{ title: 'T', url: 'https://example.com', snippet: 'snippet' }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tvly-key')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'what is zanban', max_results: 3 })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws with the status on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"detail":{"error":"Unauthorized"}}', { status: 401 }))
    )
    await expect(makeTavilyProvider('bad').search('query')).rejects.toThrow(/401/)
  })
})
