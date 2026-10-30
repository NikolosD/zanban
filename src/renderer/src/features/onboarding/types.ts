import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'
import type { SetupChoice } from './presets'

export type StepId = 'provider' | 'keys' | 'audio' | 'done'

export const STEP_ORDER: StepId[] = ['provider', 'keys', 'audio', 'done']

export interface StepProps {
  settings: AppSettings
  draftProvider: LlmProvider
  setDraftProvider: (p: LlmProvider) => void
  setup: SetupChoice
  setSetup: (choice: SetupChoice) => void
  setSpeechEngine: (engine: SttProvider) => void
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  goNext: () => void
  goBack: () => void
  complete: () => Promise<void>
}
