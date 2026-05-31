import type { AppSettings, LlmProvider } from '@shared/types'

export type StepId = 'language' | 'provider' | 'keys' | 'persona' | 'hotkeys' | 'done'

export const STEP_ORDER: StepId[] = ['language', 'provider', 'keys', 'persona', 'hotkeys', 'done']

export interface StepProps {
  settings: AppSettings
  draftProvider: LlmProvider
  setDraftProvider: (p: LlmProvider) => void
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  goNext: () => void
  goBack: () => void
  complete: () => Promise<void>
}
