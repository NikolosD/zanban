import type { GatewayProvider } from '@ai-sdk/gateway'
import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { catalogModel, refreshGatewayCatalog, type CatalogModel } from '../../ai/gatewayCatalog.js'
import { normalizeFinishReason } from './finishReason.js'

type GatewayReasoning =
  | { openai: { reasoningEffort: string } }
  | { anthropic: { thinking: { type: 'disabled' } } }
  | { anthropic: { effort: string } }

export interface GatewayCallOptions {
  temperature?: number
  providerOptions?: GatewayReasoning
}

// The default models as the catalog lists them, for answers asked before it
// loads: Terra and Haiku 5.5 would think before answering, and Haiku would
// reject the temperature.
const KNOWN_MODELS: Record<string, CatalogModel> = {
  'openai/gpt-6.1-terra': {
    id: 'openai/gpt-6.1-terra',
    reasoning_options: [{ type: 'effort', values: ['none', 'low'] }]
  },
  'anthropic/claude-haiku-5.5': {
    id: 'anthropic/claude-haiku-5.5',
    temperature: false,
    reasoning_options: [{ type: 'effort', values: ['none', 'low'] }]
  },
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
  },
  'openai/gpt-oss-120b': {
    id: 'openai/gpt-oss-120b',
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
  }
}

/**
 * Per-model options for a gateway call, read from the gateway's catalog.
 * Reasoning delays the first token of a live answer, so each model gets the
 * lowest level it accepts ('none' turns it off). Models that only take their
 * default temperature (Claude 5.x, GPT-6 Astra…) reject any other value.
 */
export function gatewayCallOptions(model: string, temperature: number): GatewayCallOptions {
  void refreshGatewayCatalog()
  const entry = catalogModel(model) ?? KNOWN_MODELS[model]
  const efforts = entry?.reasoning_options?.find((o) => o.type === 'effort')?.values
  const lowest = efforts ? ['none', 'minimal', 'low'].find((v) => efforts.includes(v)) : undefined
  return {
    temperature: entry?.temperature === false ? undefined : temperature,
    providerOptions: lowest ? reasoningFor(model.split('/')[0], lowest) : undefined
  }
}

function reasoningFor(creator: string | undefined, effort: string): GatewayReasoning | undefined {
  if (creator === 'openai') return { openai: { reasoningEffort: effort } }
  if (creator === 'anthropic') {
    return effort === 'none'
      ? { anthropic: { thinking: { type: 'disabled' } } }
      : { anthropic: { effort } }
  }
  return undefined
}

// One gateway client per API key; keyed so a rotated key in Settings gets a
// fresh one.
const clientCache = new Map<string, Promise<GatewayProvider>>()

function client(apiKey: string): Promise<GatewayProvider> {
  const cached = clientCache.get(apiKey)
  if (cached) return cached
  const promise = import('@ai-sdk/gateway').then(({ createGateway }) => createGateway({ apiKey }))
  clientCache.set(apiKey, promise)
  return promise
}

async function request(apiKey: string, args: LlmStreamArgs) {
  const gw = await client(apiKey)
  const base = {
    model: gw(args.model),
    system: args.system,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.signal,
    ...gatewayCallOptions(args.model, args.temperature ?? 0.3)
  }
  if (!args.imageDataUrl) return { ...base, prompt: args.prompt }
  return {
    ...base,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: args.prompt },
          { type: 'image' as const, image: args.imageDataUrl }
        ]
      }
    ]
  }
}

export function makeGatewayProvider(apiKey: string): ILlmProvider {
  return {
    id: 'vercel-gateway',
    label: 'Vercel AI Gateway',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      const { streamText } = await import('ai')
      const result = streamText(await request(apiKey, args))
      // fullStream rather than textStream: textStream silently drops error
      // parts, so a bad key used to end as an empty answer.
      let finishReason: string | undefined
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (part.text) yield part.text
        } else if (part.type === 'error') {
          throw part.error instanceof Error ? part.error : new Error(JSON.stringify(part.error))
        } else if (part.type === 'finish') {
          finishReason = part.finishReason
        }
      }
      return normalizeFinishReason(finishReason)
    },
    async generate(args) {
      const { generateText } = await import('ai')
      const result = await generateText(await request(apiKey, args))
      return result.text.trim()
    }
  }
}
