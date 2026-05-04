import type { ILlmProvider, LlmStreamArgs } from '../types.js'

interface GroqLike {
  chat: {
    completions: {
      create(args: {
        model: string
        messages: Array<{ role: string; content: unknown }>
        max_tokens?: number
        temperature?: number
        stream?: boolean
      }): Promise<
        | AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>
        | { choices: Array<{ message: { content?: string } }> }
      >
    }
  }
}

// Groq's vision-capable models (llama-3.2-*-vision) accept the same OpenAI-style
// image_url content blocks that OpenAI itself does. Non-vision models will
// reject the multimodal content with a 400 — that's expected, the user should
// pair the vision model ID with image input.
function buildMessages(args: LlmStreamArgs): Array<{ role: string; content: unknown }> {
  const sys = { role: 'system', content: args.system }
  if (args.imageDataUrl) {
    return [
      sys,
      {
        role: 'user',
        content: [
          { type: 'text', text: args.prompt },
          { type: 'image_url', image_url: { url: args.imageDataUrl } }
        ]
      }
    ]
  }
  return [sys, { role: 'user', content: args.prompt }]
}

async function client(apiKey: string): Promise<GroqLike> {
  const mod = (await import('groq-sdk')) as unknown as {
    default: new (opts: { apiKey: string }) => GroqLike
  }
  return new mod.default({ apiKey })
}

export function makeGroqProvider(apiKey: string): ILlmProvider {
  return {
    id: 'groq',
    label: 'Groq',
    async *stream(args: LlmStreamArgs) {
      const c = await client(apiKey)
      const res = (await c.chat.completions.create({
        model: args.model,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 1200,
        temperature: args.temperature ?? 0.3,
        stream: true
      })) as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>
      for await (const chunk of res) {
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) yield delta
      }
    },
    async generate(args) {
      const c = await client(apiKey)
      const res = (await c.chat.completions.create({
        model: args.model,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 800,
        temperature: args.temperature ?? 0.3,
        stream: false
      })) as { choices: Array<{ message: { content?: string } }> }
      return (res.choices[0]?.message?.content ?? '').trim()
    }
  }
}
