import { CheckCircle2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import type { StepProps } from '../types'

export function DoneStep({ complete, goBack }: StepProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
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
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button onClick={() => void complete()}>{t('common.finish')}</Button>
      </div>
    </div>
  )
}
