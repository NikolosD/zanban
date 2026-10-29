import { getSettings } from '../settings.js'
import {
  PROVIDER_FAST_MODELS,
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_VISION_MODELS,
  type AiRole,
  type LlmProvider
} from '../../shared/types.js'
import { servesModel } from '../../shared/modelIds.js'
import { catalogModel, refreshGatewayCatalog, type CatalogModel } from './gatewayCatalog.js'
import { modelIds, refreshModels } from './providerModels.js'

/**
 * Resolve the model ID for a given role.
 *
 * Resolution order:
 *   1. user override stored under `aiModels[provider][role]`
 *   2. per-provider default in `PROVIDER_MODEL_DEFAULTS[provider][role]`
 *
 * Switching providers in Settings automatically swaps which slot of overrides
 * applies — the user doesn't have to retype model IDs each time. For the
 * `vision` role we look up the model in the *vision provider*'s bucket when
 * the user has configured a separate visionProvider override, so the picked
 * model belongs to the same vendor that will actually run the request.
 */
export function modelFor(role: AiRole): string {
  const settings = getSettings()
  const provider: LlmProvider =
    role === 'vision' && settings.visionProvider ? settings.visionProvider : settings.llmProvider
  const userOverride = settings.aiModels?.[provider]?.[role]?.trim()
  if (userOverride) return userOverride
  return PROVIDER_MODEL_DEFAULTS[provider][role]
}

/**
 * The model to call for a role: the configured one, unless the provider's model
 * list no longer has it — then the role's default, or else the first curated
 * pick still listed, so a retired model doesn't fail the answer. Nothing is
 * swapped while the list is unknown.
 */
export function availableModel(provider: LlmProvider, model: string, role: AiRole): string {
  void refreshModels(provider)
  const ids = modelIds(provider)
  if (!ids || servesModel(ids, model)) return model
  const curated =
    role === 'vision' ? PROVIDER_VISION_MODELS[provider] : PROVIDER_FAST_MODELS[provider]
  const candidates = [PROVIDER_MODEL_DEFAULTS[provider][role], ...curated]
  return candidates.find((m) => servesModel(ids, m)) ?? model
}

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

// Caps the streaming answer so the overlay never has to wait on an over-long
// response. 600 output tokens ≈ 3-5 bullets or 1-2 short paragraphs, which is
// the answer shape the system prompt asks for.
export const FAST_MAX_OUTPUT_TOKENS = 600

// Raised cap used when the user enables "Detailed answers" in Settings. ~1800
// tokens ≈ 3-4 full paragraphs or a short code walkthrough — enough that text
// answers rarely truncate, at the cost of a longer stream.
export const DETAILED_MAX_OUTPUT_TOKENS = 1800

/**
 * Resolve the streaming text-answer token cap from the "Detailed answers"
 * toggle. Vision answers don't go through here — they use their own 8k ceiling.
 */
export function fastMaxOutputTokens(detailedAnswers: boolean): number {
  return detailedAnswers ? DETAILED_MAX_OUTPUT_TOKENS : FAST_MAX_OUTPUT_TOKENS
}
