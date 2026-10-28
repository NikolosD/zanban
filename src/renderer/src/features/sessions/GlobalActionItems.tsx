import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { queryKeys } from '@renderer/lib/queryKeys'
import { formatFallbackTitle } from '@renderer/lib/dateFormat'
import type { GlobalActionItem } from '@shared/recap-types'
import { isActionItemChecked, setActionItemChecked } from './actionItemState'

const COLLAPSED_COUNT = 5

/**
 * Global Action Items panel — every "owner: you" action item that the user
 * hasn't ticked off yet, aggregated across all sessions and linked back to the
 * session it came from. Checked state lives in localStorage (same stable text
 * hash as the per-session recap checkboxes), so ticking an item here keeps it
 * in sync with the RecapTab and vice-versa.
 */
export function GlobalActionItems({ onSelect }: { onSelect(sessionId: string): void }) {
  const { t, i18n } = useTranslation()
  const { data } = useQuery({
    queryKey: queryKeys.globalActionItems,
    queryFn: () => window.zanban.recap.listActionItems(),
    refetchOnWindowFocus: true
  })

  // Items the user has locally checked off. Tracked in component state so a
  // tick removes the row immediately without a server round-trip.
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)

  const open = useMemo(() => {
    if (!data) return []
    return data.filter(
      (it) => !isActionItemChecked(it.sessionId, it) && !checkedKeys.has(keyOf(it))
    )
  }, [data, checkedKeys])

  if (open.length === 0) return null
  const visible = showAll ? open : open.slice(0, COLLAPSED_COUNT)

  function check(it: GlobalActionItem): void {
    setActionItemChecked(it.sessionId, it, true)
    setCheckedKeys((prev) => new Set(prev).add(keyOf(it)))
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckSquare className="size-3.5 text-muted-foreground" />
        <h2 className="font-mono text-meta uppercase tracking-[0.16em] text-muted-foreground">
          {t('action_items_panel.title', { count: open.length })}
        </h2>
      </div>
      <ul className="flex flex-col rounded-lg border border-white/[0.06] bg-white/[0.015]">
        {visible.map((it, i) => (
          <li
            key={keyOf(it)}
            className={cn(
              'flex items-start gap-3 px-3 py-2.5',
              i < visible.length - 1 && 'border-b border-white/[0.045]'
            )}
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => check(it)}
              className="mt-1"
              aria-label={t('action_items_panel.mark_done')}
            />
            <div className="min-w-0 flex-1">
              <div className="text-body leading-relaxed text-foreground/90">{it.text}</div>
              <button
                type="button"
                onClick={() => onSelect(it.sessionId)}
                className="mt-0.5 truncate text-left font-mono text-meta text-muted-foreground hover:text-foreground"
              >
                {it.sessionTitle ||
                  formatFallbackTitle(new Date(it.sessionStartedAt), i18n.language)}
              </button>
            </div>
            {it.dueHint && (
              <span className="shrink-0 font-mono text-meta text-muted-foreground">
                {it.dueHint}
              </span>
            )}
          </li>
        ))}
      </ul>
      {open.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start px-1 text-small text-muted-foreground transition-colors hover:text-foreground"
        >
          {showAll
            ? t('dashboard.action_items.show_less')
            : t('dashboard.action_items.show_all', { count: open.length })}
        </button>
      )}
    </section>
  )
}

function keyOf(it: GlobalActionItem): string {
  return `${it.sessionId}::${it.text}`
}
