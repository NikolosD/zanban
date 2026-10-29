import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { cn } from '@renderer/lib/utils'

type UiLocale = AppSettings['uiLocale']

const LOCALES: Array<{ id: UiLocale; label: string }> = [
  { id: 'en', label: 'EN' },
  { id: 'ru', label: 'RU' }
]

export function LanguageSwitch({
  value,
  onChange
}: {
  value: UiLocale
  onChange: (next: UiLocale) => void
}) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('onboarding.language_label')} className="flex items-center">
      {LOCALES.map((locale, i) => (
        <span key={locale.id} className="flex items-center">
          {i > 0 && <span aria-hidden className="mx-1 h-3 w-px bg-border/60" />}
          <button
            type="button"
            aria-pressed={value === locale.id}
            onClick={() => onChange(locale.id)}
            className={cn(
              'rounded px-1 font-mono text-meta transition-colors',
              value === locale.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {locale.label}
          </button>
        </span>
      ))}
    </div>
  )
}
