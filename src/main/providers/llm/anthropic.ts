import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { normalizeFinishReason } from './finishReason.js'

interface AnthropicSdk {
  messages: {
    create(
      args: {
        model: string
        system: string
        messages: Array<{ role: string; content: unknown }>
        max_tokens: number
        thinking?: { type: 'disabled' | 'between_tools' }
        stream?: boolean
      },
      opts?: { signal?: AbortSignal }
    ): Promise<{ content: Array<{ type: string; text?: string }> } | AsyncIterable<unknown>>
    stream(
      args: {
        model: string
        system: string
        messages: Array<{ role: string; content: unknown }>
        max_tokens: number
        thinking?: { type: 'disabled' | 'between_tools' }
      },
      opts?: { signal?: AbortSignal }
    ): AsyncIterable<unknown> & {
      finalMessage(): Promise<{ content: Array<{ type: string; text?: string }> }>
    }
  }
}

// One SDK instance per API key so its HTTP keep-alive pool is reused across
// Asks; keyed so a rotated key in Settings gets a fresh client.
const clientCache = new Map<string, Promise<AnthropicSdk>>()

async function client(apiKey: string): Promise<AnthropicSdk> {
  const cached = clientCache.get(apiKey)
  if (cached) return cached
  const promise = (async () => {
    const mod = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (opts: { apiKey: string }) => AnthropicSdk
    }
    return new mod.default({ apiKey })
  })()
  clientCache.set(apiKey, promise)
  return promise
}

// Claude 5.5 models think before answering by default, which delays the first
// streamed token. Haiku 5.5 turns it off with 'disabled'; Sonnet 5.5 rejects
// that and takes 'between_tools' (no thinking when there are no tool calls).
function thinkingFor(model: string): { type: 'disabled' | 'between_tools' } | undefined {
  if (model.startsWith('claude-haiku-5-5')) return { type: 'disabled' }
  if (model.startsWith('claude-sonnet-5-5')) return { type: 'between_tools' }
  return undefined
}

// The caller's temperature is not forwarded: Claude 4.7+ and 5.x models reject
// any non-default value with a 400.
export function makeAnthropicProvider(apiKey: string): ILlmProvider {
  return {
    id: 'anthropic',
    label: 'Anthropic Claude',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      const c = await client(apiKey)
      const stream = c.messages.stream(
        {
          model: args.model,
          system: args.system,
          messages: buildMessages(args),
          max_tokens: args.maxOutputTokens ?? 1200,
          thinking: thinkingFor(args.model)
        },
        { signal: args.signal }
      )
      // Anthropic surfaces the stop reason on the `message_delta` event
      // (delta.stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | …).
      let stopReason: string | null | undefined
      for await (const event of stream as AsyncIterable<{
        type?: string
        delta?: { type?: string; text?: string; stop_reason?: string | null }
      }>) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          if (event.delta.text) yield event.delta.text
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason
        }
      }
      return normalizeFinishReason(stopReason)
    },
    async generate(args) {
      const c = await client(apiKey)
      const res = (await c.messages.create(
        {
          model: args.model,
          system: args.system,
          messages: buildMessages(args),
          max_tokens: args.maxOutputTokens ?? 800,
          thinking: thinkingFor(args.model),
          stream: false
        },
        { signal: args.signal }
      )) as { content: Array<{ type: string; text?: string }> }
      return res.content
        .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
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
