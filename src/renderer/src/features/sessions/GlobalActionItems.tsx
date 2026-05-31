import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { GlobalActionItem } from '@shared/recap-types'
import { isActionItemChecked, setActionItemChecked } from './actionItemState'

/**
 * Global Action Items panel — every "owner: you" action item that the user
 * hasn't ticked off yet, aggregated across all sessions and linked back to the
 * session it came from. Checked state lives in localStorage (same stable text
 * hash as the per-session recap checkboxes), so ticking an item here keeps it
 * in sync with the RecapTab and vice-versa.
 */
export function GlobalActionItems({ onSelect }: { onSelect(sessionId: string): void }) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['global-action-items'],
    queryFn: () => window.zanban.recap.listActionItems(),
    refetchOnWindowFocus: true
  })

  // Items the user has locally checked off. Tracked in component state so a
  // tick removes the row immediately without a server round-trip.
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set())

  const open = useMemo(() => {
    if (!data) return []
    return data.filter(
      (it) => !isActionItemChecked(it.sessionId, it) && !checkedKeys.has(keyOf(it))
    )
  }, [data, checkedKeys])

  if (open.length === 0) return null

  function check(it: GlobalActionItem): void {
    setActionItemChecked(it.sessionId, it, true)
    setCheckedKeys((prev) => new Set(prev).add(keyOf(it)))
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckSquare className="size-3.5 text-muted-foreground" />
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('action_items_panel.title', { count: open.length })}
        </h2>
      </div>
      <ul className="flex flex-col rounded-lg border border-white/[0.06] bg-white/[0.015]">
        {open.map((it, i) => (
          <li
            key={keyOf(it)}
            className={cn(
              'flex items-start gap-3 px-3 py-2.5',
              i < open.length - 1 && 'border-b border-white/[0.045]'
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
              <div className="text-[13px] leading-relaxed text-foreground/90">{it.text}</div>
              <button
                type="button"
                onClick={() => onSelect(it.sessionId)}
                className="mt-0.5 truncate text-left font-mono text-[10px] text-muted-foreground/70 hover:text-foreground"
              >
                {it.sessionTitle || new Date(it.sessionStartedAt).toLocaleString()}
              </button>
            </div>
            {it.dueHint && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {it.dueHint}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function keyOf(it: GlobalActionItem): string {
  return `${it.sessionId}::${it.text}`
}
