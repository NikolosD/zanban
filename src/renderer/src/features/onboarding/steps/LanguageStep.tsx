import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { RESPONSE_LANGUAGES, type ResponseLanguage } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { recapAfterAnswersChange } from '@renderer/features/settings/languages'
import { cn } from '@renderer/lib/utils'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'

export function LanguageStep({ settings, update, goNext }: StepProps) {
  const { t } = useTranslation()
  const current = settings.uiLocale
  const answersLabelId = useId()

  async function setAnswers(next: ResponseLanguage): Promise<void> {
    await update('responseLanguage', next)
    const recap = recapAfterAnswersChange(settings, next)
    if (recap !== settings.recap) await update('recap', recap)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lead font-medium tracking-tight">{t('onboarding.language.title')}</h2>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t('onboarding.language.body')}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
          {t('onboarding.language.section_label')}
        </div>
        <div className="flex gap-2">
          <LangCard
            label={t('onboarding.language.english_label')}
            sublabel={t('onboarding.language.english_sublabel')}
            active={current === 'en'}
            onClick={() => void update('uiLocale', 'en')}
          />
          <LangCard
            label={t('onboarding.language.russian_label')}
            sublabel={t('onboarding.language.russian_sublabel')}
            active={current === 'ru'}
            onClick={() => void update('uiLocale', 'ru')}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          id={answersLabelId}
          className="font-mono text-meta uppercase tracking-wider text-muted-foreground"
        >
          {t('onboarding.language.answers_label')}
        </div>
        <Select
          value={settings.responseLanguage}
          onValueChange={(v) => void setAnswers(v as ResponseLanguage)}
        >
          <SelectTrigger aria-labelledby={answersLabelId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSE_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {t(`settings.response_languages.${l.value}`, { defaultValue: l.label })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-small text-muted-foreground">{t('onboarding.language.answers_hint')}</p>
      </div>
      <StepFooter className="justify-end">
        <Button onClick={goNext}>{t('common.next')}</Button>
      </StepFooter>
    </div>
  )
}

function LangCard({
  label,
  sublabel,
  active,
  onClick
}: {
  label: string
  sublabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10 text-foreground'
          : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
      )}
    >
      <div className="text-body">{label}</div>
      <div className="text-small text-muted-foreground">{sublabel}</div>
    </button>
  )
}
