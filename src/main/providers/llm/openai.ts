import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { normalizeFinishReason } from './finishReason.js'

interface OpenAILike {
  chat: {
    completions: {
      create(
        args: {
          model: string
          messages: Array<{ role: string; content: unknown }>
          max_completion_tokens?: number
          reasoning_effort?: 'none'
          stream?: boolean
        },
        opts?: { signal?: AbortSignal }
      ): Promise<
        | AsyncIterable<{
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
          }>
        | { choices: Array<{ message: { content?: string } }> }
      >
    }
  }
}

// One SDK instance per API key so its HTTP keep-alive pool is reused across
// Asks; keyed so a rotated key in Settings gets a fresh client.
const clientCache = new Map<string, Promise<OpenAILike>>()

async function client(apiKey: string): Promise<OpenAILike> {
  const cached = clientCache.get(apiKey)
  if (cached) return cached
  const promise = (async () => {
    const mod = (await import('openai')) as unknown as {
      default: new (opts: { apiKey: string }) => OpenAILike
    }
    return new mod.default({ apiKey })
  })()
  clientCache.set(apiKey, promise)
  return promise
}

// GPT-6 models reason by default (effort 'medium'), which delays the first
// token and spends the output cap; 'none' turns it off. Reasoning models reject
// `max_tokens` and a non-default temperature, so the caller's is not forwarded.
export function makeOpenAiProvider(apiKey: string): ILlmProvider {
  return {
    id: 'openai',
    label: 'OpenAI',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      const c = await client(apiKey)
      const res = (await c.chat.completions.create(
        {
          model: args.model,
          messages: buildMessages(args),
          max_completion_tokens: args.maxOutputTokens ?? 1200,
          reasoning_effort: 'none',
          stream: true
        },
        { signal: args.signal }
      )) as AsyncIterable<{
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
      const c = await client(apiKey)
      const res = (await c.chat.completions.create(
        {
          model: args.model,
          messages: buildMessages(args),
          max_completion_tokens: args.maxOutputTokens ?? 800,
          reasoning_effort: 'none',
          stream: false
        },
        { signal: args.signal }
      )) as { choices: Array<{ message: { content?: string } }> }
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
