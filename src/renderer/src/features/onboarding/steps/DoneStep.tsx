import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { acceleratorTokens } from '@renderer/features/settings/KeyRecorder'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'
import { TestCall } from './TestCall'

const KEY_HOTKEYS = ['toggleOverlay', 'answerLast', 'toggleSession'] as const

export function DoneStep({ settings, complete, goBack }: StepProps) {
  const { t } = useTranslation()
  const missing = missingProviderNames(settings)
  return (
    <div className="flex flex-col gap-4">
      {missing.length > 0 ? (
        <div className="flex flex-col items-start gap-3">
          <AlertTriangle className="size-8 text-warn" />
          <div>
            <h2 className="text-lead font-medium tracking-tight">
              {t('onboarding.done.missing_title')}
            </h2>
            <p className="mt-1 text-body leading-relaxed text-muted-foreground">
              {t('onboarding.done.missing_body')}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {missing.map((name) => (
                <li key={name} className="text-body text-foreground">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 className="size-8 text-success" />
          <div>
            <h2 className="text-lead font-medium tracking-tight">{t('onboarding.done.title')}</h2>
            <p className="mt-1 text-body leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="onboarding.done.body"
                components={[<span key="0" className="text-foreground" />]}
              />
            </p>
          </div>
        </div>
      )}
      <TestCall settings={settings} />
      <div className="flex flex-col gap-2">
        <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
          {t('onboarding.done.hotkeys_title')}
        </div>
        <div className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
          {KEY_HOTKEYS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-body">{t(`onboarding.done.hotkeys.${k}`)}</span>
              <span className="flex items-center gap-1">
                {acceleratorTokens(settings.hotkeys[k]).map((part, i) => (
                  <Kbd key={i} size="md">
                    {part}
                  </Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="text-small text-muted-foreground">{t('onboarding.done.hotkeys_more')}</p>
      </div>
      <p className="text-small text-muted-foreground">{t('onboarding.done.persona_hint')}</p>
      <StepFooter>
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button onClick={() => void complete()}>{t('common.finish')}</Button>
      </StepFooter>
    </div>
  )
}
