import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'

export function DoneStep({ settings, complete, goBack }: StepProps) {
  const { t } = useTranslation()
  const missing = missingProviderNames(settings)
  return (
    <div className="flex flex-col gap-4">
      {missing.length > 0 ? (
        <div className="flex flex-col items-start gap-3">
          <AlertTriangle className="size-8 text-amber-400" />
          <div>
            <h2 className="text-lg font-medium tracking-tight">
              {t('onboarding.done.missing_title')}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {t('onboarding.done.missing_body')}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {missing.map((name) => (
                <li key={name} className="text-[13px] text-foreground">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 className="size-8 text-primary" />
          <div>
            <h2 className="text-lg font-medium tracking-tight">{t('onboarding.done.title')}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="onboarding.done.body"
                components={[<span key="0" className="text-foreground" />]}
              />
            </p>
          </div>
        </div>
      )}
      <StepFooter>
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button onClick={() => void complete()}>{t('common.finish')}</Button>
      </StepFooter>
    </div>
  )
}
