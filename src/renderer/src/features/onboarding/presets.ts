import { PROVIDER_MODEL_DEFAULTS } from '@shared/types'
import type { AiModelSettings, AppSettings, LlmProvider, SttProvider } from '@shared/types'

export type PresetId = 'recommended' | 'quality' | 'private'

export interface SetupPreset {
  id: PresetId
  llmProvider: LlmProvider
  sttProvider: SttProvider
  /** Gateway model overrides; absent means the gateway defaults. */
  gatewayModels?: AiModelSettings
  privacyMode: boolean
}

// One model for answers, screenshots and recaps: GPT-6.1 Terra without
// reasoning answers in about a second and is the strongest of the fast models.
const QUALITY_MODEL = 'openai/gpt-6.1-terra'

export const SETUP_PRESETS: SetupPreset[] = [
  {
    id: 'recommended',
    llmProvider: 'vercel-gateway',
    sttProvider: 'local-whisper',
    privacyMode: false
  },
  {
    id: 'quality',
    llmProvider: 'vercel-gateway',
    sttProvider: 'elevenlabs',
    gatewayModels: {
      ...PROVIDER_MODEL_DEFAULTS['vercel-gateway'],
      fast: QUALITY_MODEL,
      summary: QUALITY_MODEL,
      vision: QUALITY_MODEL
    },
    privacyMode: false
  },
  {
    id: 'private',
    llmProvider: 'ollama',
    sttProvider: 'local-whisper',
    privacyMode: true
  }
]

/** The preset the current settings match, or null when they were set by hand. */
export function matchPreset(settings: AppSettings): PresetId | null {
  const gateway = settings.aiModels?.['vercel-gateway']
  const match = SETUP_PRESETS.find(
    (p) =>
      p.llmProvider === settings.llmProvider &&
      p.sttProvider === settings.sttProvider &&
      (p.llmProvider !== 'vercel-gateway' || gateway?.fast === p.gatewayModels?.fast)
  )
  return match?.id ?? null
}

/** The settings patch that applies a preset. */
export function presetPatch(preset: SetupPreset, settings: AppSettings): Partial<AppSettings> {
  const aiModels = { ...settings.aiModels }
  if (preset.gatewayModels) aiModels['vercel-gateway'] = preset.gatewayModels
  else if (preset.llmProvider === 'vercel-gateway') delete aiModels['vercel-gateway']
  return {
    llmProvider: preset.llmProvider,
    sttProvider: preset.sttProvider,
    aiModels,
    privacyMode: preset.privacyMode,
    privacyModeSnapshot: null
  }
}
