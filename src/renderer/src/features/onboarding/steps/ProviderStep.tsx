import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { AppSettings, LlmProvider } from '@shared/types'
import type { StepProps } from '../types'
import { presetPatch, SETUP_PRESETS } from '../presets'
import { StepFooter } from './StepFooter'

type BadgeKey = 'recommended' | 'no_key'

interface ProviderOption {
  id: LlmProvider
  badge?: BadgeKey
}

// Order is the suggested visual order in the wizard. Keep cloud aggregator
// first (covers the most providers with a single key), then direct vendor
// APIs by familiarity, with the local option last.
const OPTIONS: ProviderOption[] = [
  { id: 'vercel-gateway', badge: 'recommended' },
  { id: 'anthropic' },
  { id: 'openai' },
  { id: 'google-gemini' },
  { id: 'groq' },
  { id: 'ollama', badge: 'no_key' }
]

// Same treatment as the provider cards in Settings: sage for the recommended
// pick, neutral for a plain fact.
const BADGE_STYLES: Record<BadgeKey, string> = {
  recommended: 'border-success/30 bg-success/10 text-success',
  no_key: 'border-border text-muted-foreground'
}

export function ProviderStep({
  settings,
  draftProvider,
  setDraftProvider,
  setup,
  setSetup,
  setSpeechEngine,
  update,
  goNext
}: StepProps) {
  const { t } = useTranslation()

  async function next(): Promise<void> {
    const preset = SETUP_PRESETS.find((p) => p.id === setup)
    if (preset) {
      const patch = presetPatch(preset, settings)
      for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
        await update(key, patch[key] as never)
      }
      setDraftProvider(preset.llmProvider)
      setSpeechEngine(preset.sttProvider)
    } else {
      await update('llmProvider', draftProvider)
    }
    goNext()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lead font-medium tracking-tight">{t('onboarding.provider.title')}</h2>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t('onboarding.provider.body')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {[...SETUP_PRESETS.map((p) => p.id), 'manual' as const].map((id) => (
          <Option key={id} selected={setup === id} onSelect={() => setSetup(id)}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-body">{t(`onboarding.presets.${id}.label`)}</span>
              {id !== 'manual' && (
                <span className="rounded border border-border px-1 font-mono text-meta text-muted-foreground">
                  {t(`onboarding.presets.${id}.price`)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
              {t(`onboarding.presets.${id}.blurb`)}
            </div>
          </Option>
        ))}
      </div>

      {setup === 'manual' && (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
            {t('onboarding.provider.manual_label')}
          </div>
          {OPTIONS.map((opt) => (
            <Option
              key={opt.id}
              selected={draftProvider === opt.id}
              onSelect={() => setDraftProvider(opt.id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-body">
                  {t(`onboarding.provider.options.${opt.id}.label`)}
                </span>
                {opt.badge && (
                  <span
                    className={cn(
                      'rounded border px-1 font-mono text-meta uppercase tracking-wider',
                      BADGE_STYLES[opt.badge]
                    )}
                  >
                    {t(`onboarding.provider.${opt.badge}_badge`)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
                {t(`onboarding.provider.options.${opt.id}.blurb`)}
              </div>
            </Option>
          ))}
        </div>
      )}

      <StepFooter className="justify-end">
        <Button onClick={() => void next()}>{t('common.next')}</Button>
      </StepFooter>
    </div>
  )
}

function Option({
  selected,
  onSelect,
  children
}: {
  selected: boolean
  onSelect(): void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
      )}
    >
      <div
        aria-hidden
        className={cn(
          'mt-1 size-2 shrink-0 rounded-full',
          selected ? 'bg-primary' : 'bg-muted-foreground/40'
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </button>
  )
}
