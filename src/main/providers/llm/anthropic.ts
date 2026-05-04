import type { ILlmProvider, LlmStreamArgs } from '../types.js'

interface AnthropicSdk {
  messages: {
    create(args: {
      model: string
      system: string
      messages: Array<{ role: string; content: unknown }>
      max_tokens: number
      temperature?: number
      stream?: boolean
    }): Promise<{ content: Array<{ type: string; text?: string }> } | AsyncIterable<unknown>>
    stream(args: {
      model: string
      system: string
      messages: Array<{ role: string; content: unknown }>
      max_tokens: number
      temperature?: number
    }): AsyncIterable<unknown> & { finalMessage(): Promise<{ content: Array<{ type: string; text?: string }> }> }
  }
}

async function client(apiKey: string): Promise<AnthropicSdk> {
  const mod = (await import('@anthropic-ai/sdk')) as unknown as {
    default: new (opts: { apiKey: string }) => AnthropicSdk
  }
  return new mod.default({ apiKey })
}

export function makeAnthropicProvider(apiKey: string): ILlmProvider {
  return {
    id: 'anthropic',
    label: 'Anthropic Claude',
    async *stream(args: LlmStreamArgs) {
      const c = await client(apiKey)
      const stream = c.messages.stream({
        model: args.model,
        system: args.system,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 1200,
        temperature: args.temperature ?? 0.3
      })
      for await (const event of stream as AsyncIterable<{
        type?: string
        delta?: { type?: string; text?: string }
      }>) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          if (event.delta.text) yield event.delta.text
        }
      }
    },
    async generate(args) {
      const c = await client(apiKey)
      const res = (await c.messages.create({
        model: args.model,
        system: args.system,
        messages: buildMessages(args),
        max_tokens: args.maxOutputTokens ?? 800,
        temperature: args.temperature ?? 0.3,
        stream: false
      })) as { content: Array<{ type: string; text?: string }> }
      return res.content
        .map((b) => (b.type === 'text' ? b.text ?? '' : ''))
        .join('')
        .trim()
    }
  }
}

function buildMessages(args: LlmStreamArgs): Array<{ role: string; content: unknown }> {
  if (args.imageDataUrl) {
    const match = args.imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
    const media = match ? { type: 'base64', media_type: match[1], data: match[2] } : null
    return [
      {
        role: 'user',
        content: [
          ...(media ? [{ type: 'image', source: media }] : []),
          { type: 'text', text: args.prompt }
        ]
      }
    ]
  }
  return [{ role: 'user', content: args.prompt }]
}
