import type { ILlmProvider, LlmStreamArgs } from '../types.js'

interface GeminiLike {
  models: {
    // The SDK returns a Promise that resolves to the async iterable — both
    // calls must be awaited before iterating.
    generateContentStream(args: {
      model: string
      contents: unknown
      config?: { temperature?: number; maxOutputTokens?: number; systemInstruction?: string }
    }): Promise<AsyncIterable<{ text?: string }>>
    generateContent(args: {
      model: string
      contents: unknown
      config?: { temperature?: number; maxOutputTokens?: number; systemInstruction?: string }
    }): Promise<{ text?: string }>
  }
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

// Gemini returns 503 UNAVAILABLE during capacity spikes (especially on freshly
// GA'd models like gemini-3.5-flash) and 429 RESOURCE_EXHAUSTED when the
// per-project quota is briefly hit. Both are transient. We retry the *initial*
// call only — once a stream has yielded text we can't restart without
// duplicating output to the consumer.
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: number | string; code?: number; message?: string }
  if (e.status === 503 || e.status === 429) return true
  if (e.code === 503 || e.code === 429) return true
  const msg = typeof e.message === 'string' ? e.message : ''
  return /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)\b/i.test(msg)
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === MAX_RETRIES || !isTransientError(err)) throw err
      // 500ms → 1s → 2s, plus up to 250ms jitter to avoid thundering-herd
      // when multiple in-flight Asks fail at the same moment.
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 250)
      console.warn(
        `[gemini] ${label} transient error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms`,
        err
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastErr
}

// Cache the GoogleGenAI instance per API key. The constructor itself is light,
// but the SDK lazily warms up an internal HTTP client on first use; reusing
// the instance across requests keeps that warmup amortized instead of paying
// it on every Ask. Keyed by apiKey so a user rotating their key in Settings
// doesn't keep talking to the old client.
const clientCache = new Map<string, Promise<GeminiLike>>()

async function client(apiKey: string): Promise<GeminiLike> {
  const cached = clientCache.get(apiKey)
  if (cached) return cached
  const promise = (async () => {
    const mod = (await import('@google/genai')) as unknown as {
      GoogleGenAI: new (opts: { apiKey: string }) => GeminiLike
    }
    return new mod.GoogleGenAI({ apiKey })
  })()
  clientCache.set(apiKey, promise)
  return promise
}

function buildContents(args: LlmStreamArgs): unknown {
  if (args.imageDataUrl) {
    const match = args.imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
    return [
      {
        role: 'user',
        parts: [
          ...(match ? [{ inlineData: { mimeType: match[1], data: match[2] } }] : []),
          { text: args.prompt }
        ]
      }
    ]
  }
  return [{ role: 'user', parts: [{ text: args.prompt }] }]
}

export function makeGeminiProvider(apiKey: string): ILlmProvider {
  return {
    id: 'google-gemini',
    label: 'Google Gemini',
    async *stream(args: LlmStreamArgs) {
      const c = await client(apiKey)
      // generateContentStream returns Promise<AsyncIterable> — must await
      // BEFORE the for-await loop, otherwise we try to iterate the Promise
      // itself and get "TypeError: it is not async iterable".
      // Retry only the initial call: once iteration starts we've already
      // yielded text to the consumer and can't replay.
      const it = await withRetry(`stream(${args.model})`, () =>
        c.models.generateContentStream({
          model: args.model,
          contents: buildContents(args),
          config: {
            systemInstruction: args.system,
            temperature: args.temperature ?? 0.3,
            maxOutputTokens: args.maxOutputTokens ?? 1200
          }
        })
      )
      for await (const chunk of it) {
        if (chunk.text) yield chunk.text
      }
    },
    async generate(args) {
      const c = await client(apiKey)
      const res = await withRetry(`generate(${args.model})`, () =>
        c.models.generateContent({
          model: args.model,
          contents: buildContents(args),
          config: {
            systemInstruction: args.system,
            temperature: args.temperature ?? 0.3,
            maxOutputTokens: args.maxOutputTokens ?? 800
          }
        })
      )
      return (res.text ?? '').trim()
    }
  }
}
