import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import type { AppSettings, LlmProvider } from '@shared/types'
import { LanguageStep } from './steps/LanguageStep'
import { ProviderStep } from './steps/ProviderStep'
import { ApiKeysStep } from './steps/ApiKeysStep'
import { PersonaStep } from './steps/PersonaStep'
import { HotkeysStep } from './steps/HotkeysStep'
import { DoneStep } from './steps/DoneStep'
import { STEP_ORDER, type StepId, type StepProps } from './types'

export function OnboardingWizard({
  open,
  settings,
  onClose
}: {
  open: boolean
  settings: AppSettings
  onClose: () => void
}) {
  const [step, setStep] = useState<StepId>('language')
  // Provider lives in local state until the user advances past the provider
  // step. That way bouncing back to change LLM doesn't immediately rewrite
  // the persisted provider on every click.
  const [draftProvider, setDraftProvider] = useState<LlmProvider>(settings.llmProvider)

  // Re-runs from Settings should land on step one with the currently
  // persisted provider as the default. Without this the second open keeps
  // whichever step the user closed on.
  useEffect(() => {
    if (open) {
      setStep('language')
      setDraftProvider(settings.llmProvider)
    }
  }, [open, settings.llmProvider])

  async function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    await window.zanban.settings.set({ [key]: value } as Partial<AppSettings>)
  }

  function goNext(): void {
    const idx = STEP_ORDER.indexOf(step)
    const next = STEP_ORDER[idx + 1]
    if (next) setStep(next)
  }

  function goBack(): void {
    const idx = STEP_ORDER.indexOf(step)
    const prev = STEP_ORDER[idx - 1]
    if (prev) setStep(prev)
  }

  async function complete(): Promise<void> {
    await update('onboardingCompleted', true)
    onClose()
  }

  const stepProps: StepProps = useMemo(
    () => ({ settings, draftProvider, setDraftProvider, update, goNext, goBack, complete }),
    // The closures above capture `step` via the outer scope — refresh memo on
    // every step change so children get the right goNext/goBack semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, draftProvider, step]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // X / outside click / Esc all count as "skip" — the wizard is helpful,
        // not a paywall. We still mark `onboardingCompleted` so it doesn't
        // re-appear next launch.
        if (!o) void complete()
      }}
    >
      <DialogContent className="sm:max-w-xl gap-0 overflow-hidden p-0 max-h-[90vh] flex flex-col">
        <WizardTitles />
        <Stepper current={step} />
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {step === 'language' && <LanguageStep {...stepProps} />}
          {step === 'provider' && <ProviderStep {...stepProps} />}
          {step === 'keys' && <ApiKeysStep {...stepProps} />}
          {step === 'persona' && <PersonaStep {...stepProps} />}
          {step === 'hotkeys' && <HotkeysStep {...stepProps} />}
          {step === 'done' && <DoneStep {...stepProps} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WizardTitles() {
  const { t } = useTranslation()
  return (
    <>
      <DialogTitle className="sr-only">{t('onboarding.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('onboarding.description')}</DialogDescription>
    </>
  )
}

function Stepper({ current }: { current: StepId }) {
  const { t } = useTranslation()
  const currentIdx = STEP_ORDER.indexOf(current)
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-6 py-3">
      {STEP_ORDER.map((id, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={id} className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-5 items-center justify-center rounded-full font-mono text-[10px]',
                done && 'bg-primary text-primary-foreground',
                active && 'bg-primary/20 text-primary ring-1 ring-primary/40',
                !done && !active && 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}
            </div>
            <div
              className={cn(
                'font-mono text-[10px] uppercase tracking-wider',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {t(`onboarding.steps.${id}`)}
            </div>
            {i < STEP_ORDER.length - 1 && <div className="h-px w-4 bg-border/60" />}
          </div>
        )
      })}
    </div>
  )
}
