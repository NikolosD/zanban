import type { ILlmProvider, LlmStreamArgs } from '../types.js'

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
        | AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>
        | { choices: Array<{ message: { content?: string } }> }
      >
    }
  }
}

export function makeOpenAiProvider(apiKey: string): ILlmProvider {
  return {
    id: 'openai',
    label: 'OpenAI',
    async *stream(args: LlmStreamArgs) {
      const c = (await client(apiKey)) as OpenAILike
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
