import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { LlmProvider } from '@shared/types'
import type { StepProps } from '../types'

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

export function ProviderStep({
  draftProvider,
  setDraftProvider,
  update,
  goNext,
  goBack
}: StepProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">{t('onboarding.provider.title')}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('onboarding.provider.body')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setDraftProvider(opt.id)}
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
              draftProvider === opt.id
                ? 'border-primary/60 bg-primary/10'
                : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
            )}
          >
            <div
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                draftProvider === opt.id ? 'bg-primary' : 'bg-muted-foreground/40'
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{t(`onboarding.provider.options.${opt.id}.label`)}</span>
                {opt.badge && (
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                    {t(`onboarding.provider.${opt.badge}_badge`)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {t(`onboarding.provider.options.${opt.id}.blurb`)}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button
          onClick={async () => {
            await update('llmProvider', draftProvider)
            goNext()
          }}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  )
}
