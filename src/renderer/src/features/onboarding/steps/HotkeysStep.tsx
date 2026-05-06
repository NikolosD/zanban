import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import type { StepProps } from '../types'

const HEADLINE_KEYS = [
  'toggleOverlay',
  'askAi',
  'answerLast',
  'screenshot',
  'showDashboard'
] as const

function platformLabel(combo: string): string[] {
  return combo.split('+').map((p) => {
    const k = p.trim()
    if (k === 'Control') return 'Ctrl'
    if (k === 'Return') return '↵'
    if (k === 'Space') return 'Space'
    return k
  })
}

export function HotkeysStep({ settings, goNext, goBack }: StepProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">{t('onboarding.hotkeys.title')}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('onboarding.hotkeys.body')}
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
        {HEADLINE_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="text-[12px]">{t(`onboarding.hotkeys.labels.${k}`)}</div>
            <div className="flex items-center gap-1">
              {platformLabel(settings.hotkeys[k]).map((part, i) => (
                <Kbd key={i}>{part}</Kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button onClick={goNext}>{t('common.next')}</Button>
      </div>
    </div>
  )
}
