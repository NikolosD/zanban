import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'

export function RecapOffer({ onOpen }: { onOpen(): void }) {
  const { t } = useTranslation()
  return (
    <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-1.5">
      <span className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
        {t('dashboard.recap_offer.label')}
      </span>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        {t('dashboard.recap_offer.open')}
      </Button>
    </div>
  )
}
