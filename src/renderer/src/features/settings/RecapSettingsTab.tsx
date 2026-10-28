import { Trans, useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Field, Row, Section, TabLink } from './layout'

const TONES = ['concise', 'friendly', 'formal'] as const

export function RecapSettingsTab({
  settings,
  update,
  onOpenGeneral
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  onOpenGeneral(): void
}) {
  const { t } = useTranslation()
  const recap = settings.recap

  return (
    <Section title={t('settings.recap.title')} hint={t('settings.recap.subtitle')}>
      <Row label={t('settings.recap.auto_label')} hint={t('settings.recap.auto_hint')}>
        <Switch
          checked={recap.autoGenerate}
          onCheckedChange={(v) => update('recap', { ...recap, autoGenerate: v })}
        />
      </Row>

      <Field label={t('settings.recap.tone_label')} hint={t('settings.recap.tone_hint')}>
        {(control) => (
          <div
            role="group"
            aria-label={t('settings.recap.tone_label')}
            aria-describedby={control['aria-describedby']}
            className="inline-flex gap-1 rounded-full border border-white/[0.06] p-1"
          >
            {TONES.map((tone) => (
              <Button
                key={tone}
                size="sm"
                aria-pressed={recap.tone === tone}
                variant={recap.tone === tone ? 'default' : 'ghost'}
                className="rounded-full px-3 text-small"
                onClick={() => update('recap', { ...recap, tone })}
              >
                {t(`settings.recap.tones.${tone}`)}
              </Button>
            ))}
          </div>
        )}
      </Field>

      <Field label={t('settings.recap.model_label')} hint={t('settings.recap.model_hint')}>
        {(control) => (
          <Input
            {...control}
            value={recap.modelOverride ?? ''}
            placeholder={t('settings.recap.model_placeholder')}
            onChange={(e) =>
              update('recap', { ...recap, modelOverride: e.target.value ? e.target.value : null })
            }
            className="font-mono text-small"
          />
        )}
      </Field>

      <p className="text-small text-muted-foreground">
        <Trans
          i18nKey="settings.recap.language_moved"
          components={{ 0: <TabLink onClick={onOpenGeneral} /> }}
        />
      </p>
    </Section>
  )
}
