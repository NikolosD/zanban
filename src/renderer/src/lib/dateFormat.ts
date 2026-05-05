/**
 * Date formatting helpers shared by the dashboard's session list. Kept
 * locale-aware via `toLocaleDateString`/`toLocaleTimeString` so display
 * follows the user's system preferences.
 */

interface DatedItem {
  startedAt: number
}

export function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export function formatGroupLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatFallbackTitle(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function formatDuration(ms?: number | null): string | null {
  if (!ms || ms < 1000) return null
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `00:${String(s).padStart(2, '0')}`
  if (m < 60) return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Bucket items by day with friendly labels: Today / Yesterday / Earlier this
 * week / month-year. Items are sorted descending by `startedAt` first.
 */
export function groupByDay<T extends DatedItem>(
  items: T[]
): Array<{ label: string; items: T[] }> {
  const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt)
  const out = new Map<string, T[]>()
  const today = startOfDay(new Date())
  const yesterday = startOfDay(new Date(today - 86_400_000))
  const sevenDaysAgo = startOfDay(new Date(today - 7 * 86_400_000))

  for (const s of sorted) {
    const day = startOfDay(new Date(s.startedAt))
    let label: string
    if (day === today) label = 'Today'
    else if (day === yesterday) label = 'Yesterday'
    else if (day > sevenDaysAgo) label = 'Earlier this week'
    else label = formatGroupLabel(new Date(s.startedAt))
    if (!out.has(label)) out.set(label, [])
    out.get(label)!.push(s)
  }
  return Array.from(out.entries()).map(([label, items]) => ({ label, items }))
}
