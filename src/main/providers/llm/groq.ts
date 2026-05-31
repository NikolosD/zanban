import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { normalizeFinishReason } from './finishReason.js'

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
        | AsyncIterable<{
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
          }>
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
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      const c = await client(apiKey)
      const res = (await c.chat.completions.create({
        model: args.model,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 1200,
        temperature: args.temperature ?? 0.3,
        stream: true
      })) as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
      }>
      // Groq mirrors OpenAI's chat-completions shape: `finish_reason` lands on
      // the terminal chunk's choice ('stop' | 'length' | 'content_filter' | …).
      let finishReason: string | null | undefined
      for await (const chunk of res) {
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const delta = choice?.delta?.content
        if (delta) yield delta
      }
      return normalizeFinishReason(finishReason)
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
