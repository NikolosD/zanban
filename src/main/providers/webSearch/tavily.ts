import type { IWebSearchProvider } from '../types.js'

interface TavilyClient {
  search(query: string, opts?: { maxResults?: number }): Promise<{
    results: Array<{ title: string; url: string; content: string }>
  }>
}

async function client(apiKey: string): Promise<TavilyClient> {
  const mod = (await import('@tavily/core')) as unknown as {
    tavily: (opts: { apiKey: string }) => TavilyClient
  }
  return mod.tavily({ apiKey })
}

export function makeTavilyProvider(apiKey: string): IWebSearchProvider {
  return {
    id: 'tavily',
    async search(query, opts) {
      const c = await client(apiKey)
      const res = await c.search(query, { maxResults: opts?.topK ?? 5 })
      return res.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content
      }))
    }
  }
}
