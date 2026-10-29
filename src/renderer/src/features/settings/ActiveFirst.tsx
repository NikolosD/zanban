import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

/**
 * The provider in use stays on top with its credentials; the alternatives fold
 * behind one button, so the tab isn't several screens of cards nobody uses.
 */
export function ActiveFirst<T extends { value: string }>({
  items,
  active,
  render
}: {
  items: T[]
  active: string
  render(item: T): React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const others = items.filter((p) => p.value !== active)
  return (
    <div className="flex flex-col gap-2.5">
      {items.filter((p) => p.value === active).map(render)}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-small text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {open
          ? t('settings.providers.hide_others')
          : t('settings.providers.show_others', { count: others.length })}
      </button>
      {open && others.map(render)}
    </div>
  )
}
