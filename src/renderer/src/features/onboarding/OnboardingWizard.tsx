import { useMemo, useState } from 'react'
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

  // Re-runs from Settings land on step one with the persisted provider. Reset
  // only on the closed→open edge: choosing a provider saves it and main
  // broadcasts the change, which must not bounce the user back to step one.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep('language')
      setDraftProvider(settings.llmProvider)
    }
  }

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
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <WizardTitles />
        <Stepper current={step} />
        {/* No bottom padding: each step's StepFooter is sticky to this edge. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
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
  // Only the active step shows its label so all six fit; pr-12 keeps the last
  // step clear of the dialog's close button.
  return (
    <ol className="flex shrink-0 items-center gap-1.5 border-b border-border/60 py-3 pr-12 pl-6">
      {STEP_ORDER.map((id, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        const label = t(`onboarding.steps.${id}`)
        return (
          <li key={id} className="flex items-center gap-1.5">
            <div
              title={active ? undefined : label}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                done && 'bg-primary text-primary-foreground',
                active && 'bg-primary/20 text-primary ring-1 ring-primary/40',
                !done && !active && 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}
            </div>
            {active ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
                {label}
              </span>
            ) : (
              <span className="sr-only">{label}</span>
            )}
            {i < STEP_ORDER.length - 1 && <div className="h-px w-3 bg-border/60" />}
          </li>
        )
      })}
    </ol>
  )
}
