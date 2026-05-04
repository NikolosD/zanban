import { getSettings } from '../settings.js'
import { PROVIDER_MODEL_DEFAULTS, type AiRole, type AppSettings } from '../../shared/types.js'

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
  const provider: AppSettings['llmProvider'] =
    role === 'vision' && settings.visionProvider
      ? settings.visionProvider
      : settings.llmProvider
  const userOverride = settings.aiModels?.[provider]?.[role]?.trim()
  if (userOverride) return userOverride
  return PROVIDER_MODEL_DEFAULTS[provider][role]
}

// Caps the streaming answer so the overlay never has to wait on an over-long
// response. 600 output tokens ≈ 3-5 bullets or 1-2 short paragraphs, which is
// the answer shape the system prompt asks for.
export const FAST_MAX_OUTPUT_TOKENS = 600
