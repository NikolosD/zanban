import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { normalizeFinishReason } from './finishReason.js'

async function client(apiKey: string): Promise<unknown> {
  const mod = (await import('openai')) as unknown as {
    default: new (opts: { apiKey: string }) => unknown
  }
  return new mod.default({ apiKey })
}

interface OpenAILike {
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

export function makeOpenAiProvider(apiKey: string): ILlmProvider {
  return {
    id: 'openai',
    label: 'OpenAI',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      const c = (await client(apiKey)) as OpenAILike
      const res = (await c.chat.completions.create({
        model: args.model,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 1200,
        temperature: args.temperature ?? 0.3,
        stream: true
      })) as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
      }>
      // OpenAI streams `finish_reason` on the terminal chunk's choice
      // ('stop' | 'length' | 'content_filter' | 'tool_calls').
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
      const c = (await client(apiKey)) as OpenAILike
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
