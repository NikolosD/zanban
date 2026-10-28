import type { IWebSearchProvider } from '../types.js'

const SEARCH_URL = 'https://api.tavily.com/search'
const SEARCH_TIMEOUT_MS = 60_000

interface TavilySearchResponse {
  results: Array<{ title: string; url: string; content: string }>
}

export function makeTavilyProvider(apiKey: string): IWebSearchProvider {
  return {
    id: 'tavily',
    async search(query, opts) {
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: opts?.topK ?? 5 }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      })
      if (!res.ok) {
        throw new Error(`Tavily error: ${res.status} ${await res.text()}`)
      }
      const data = (await res.json()) as TavilySearchResponse
      return data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content
      }))
    }
  }
}
