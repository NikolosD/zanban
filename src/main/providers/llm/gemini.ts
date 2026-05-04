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

async function client(apiKey: string): Promise<GeminiLike> {
  const mod = (await import('@google/genai')) as unknown as {
    GoogleGenAI: new (opts: { apiKey: string }) => GeminiLike
  }
  return new mod.GoogleGenAI({ apiKey })
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
      const it = await c.models.generateContentStream({
        model: args.model,
        contents: buildContents(args),
        config: {
          systemInstruction: args.system,
          temperature: args.temperature ?? 0.3,
          maxOutputTokens: args.maxOutputTokens ?? 1200
        }
      })
      for await (const chunk of it) {
        if (chunk.text) yield chunk.text
      }
    },
    async generate(args) {
      const c = await client(apiKey)
      const res = await c.models.generateContent({
        model: args.model,
        contents: buildContents(args),
        config: {
          systemInstruction: args.system,
          temperature: args.temperature ?? 0.3,
          maxOutputTokens: args.maxOutputTokens ?? 800
        }
      })
      return (res.text ?? '').trim()
    }
  }
}
