import { getSettings } from '../settings.js'
import {
  PROVIDER_FAST_MODELS,
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_VISION_MODELS,
  type AiRole,
  type LlmProvider
} from '../../shared/types.js'
import { servesModel } from '../../shared/modelIds.js'
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
 * model belongs to the same vendor that will actually run the request. The
 * fallback chain passes `provider` to read a backup provider's slot instead.
 */
export function modelFor(role: AiRole, provider?: LlmProvider): string {
  const settings = getSettings()
  provider ??=
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
