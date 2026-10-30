import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'

export type PresetId = 'recommended' | 'quality' | 'private'

export type SetupChoice = PresetId | 'manual'

export interface SetupPreset {
  id: PresetId
  llmProvider: LlmProvider
  sttProvider: SttProvider
  privacyMode: boolean
}

// Both gateway presets answer with the gateway defaults; quality adds cloud speech recognition.
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
  const match = SETUP_PRESETS.find(
    (p) =>
      p.llmProvider === settings.llmProvider &&
      p.sttProvider === settings.sttProvider &&
      (p.llmProvider !== 'vercel-gateway' || !settings.aiModels?.['vercel-gateway'])
  )
  return match?.id ?? null
}

/** The settings patch that applies a preset. */
export function presetPatch(preset: SetupPreset, settings: AppSettings): Partial<AppSettings> {
  const aiModels = { ...settings.aiModels }
  if (preset.llmProvider === 'vercel-gateway') delete aiModels['vercel-gateway']
  return {
    llmProvider: preset.llmProvider,
    sttProvider: preset.sttProvider,
    aiModels,
    privacyMode: preset.privacyMode,
    privacyModeSnapshot: null
  }
}
