import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

const TONES = ['concise', 'friendly', 'formal'] as const
const LANGS = ['auto', 'en', 'ru'] as const

export function RecapSettingsTab({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const { t } = useTranslation()
  const recap = settings.recap

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold">{t('settings.recap.title')}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('settings.recap.subtitle')}</p>
      </header>

      <Row label={t('settings.recap.auto_label')} hint={t('settings.recap.auto_hint')}>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={recap.autoGenerate}
            onChange={(e) => update('recap', { ...recap, autoGenerate: e.target.checked })}
          />
          <span className="text-[13px]">{t('settings.recap.auto_toggle')}</span>
        </label>
      </Row>

      <Row label={t('settings.recap.tone_label')} hint={t('settings.recap.tone_hint')}>
        <div className="inline-flex gap-1 rounded-full border border-white/[0.06] p-1">
          {TONES.map((tone) => (
            <Button
              key={tone}
              size="sm"
              variant={recap.tone === tone ? 'default' : 'ghost'}
              className={cn('rounded-full px-3 text-[12px]')}
              onClick={() => update('recap', { ...recap, tone })}
            >
              {t(`settings.recap.tones.${tone}`)}
            </Button>
          ))}
        </div>
      </Row>

      <Row label={t('settings.recap.language_label')} hint={t('settings.recap.language_hint')}>
        <select
          value={recap.language}
          onChange={(e) =>
            update('recap', {
              ...recap,
              language: e.target.value as (typeof LANGS)[number]
            })
          }
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[13px]"
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {t(`settings.recap.languages.${l}`)}
            </option>
          ))}
        </select>
      </Row>

      <Row label={t('settings.recap.model_label')} hint={t('settings.recap.model_hint')}>
        <input
          type="text"
          value={recap.modelOverride ?? ''}
          placeholder={t('settings.recap.model_placeholder')}
          onChange={(e) =>
            update('recap', {
              ...recap,
              modelOverride: e.target.value ? e.target.value : null
            })
          }
          className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[13px]"
        />
      </Row>
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] font-medium">{label}</div>
      {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
      <div className="mt-1">{children}</div>
    </div>
  )
}
