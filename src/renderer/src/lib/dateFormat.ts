/**
 * Date formatting helpers shared by the dashboard's session list. Callers pass
 * the UI language (i18n.language) so month and weekday names follow the app's
 * language rather than the OS locale.
 */

interface DatedItem {
  startedAt: number
}

export interface DayGroupLabels {
  today: string
  yesterday: string
  thisWeek: string
}

type DayBucket = 'today' | 'yesterday' | 'thisWeek' | 'older'

export function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

function dayBucket(ts: number, now: number): DayBucket {
  const today = startOfDay(new Date(now))
  const day = startOfDay(new Date(ts))
  if (day === today) return 'today'
  if (day === startOfDay(new Date(today - 86_400_000))) return 'yesterday'
  if (day > startOfDay(new Date(today - 7 * 86_400_000))) return 'thisWeek'
  return 'older'
}

export function formatGroupLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

export function formatTime(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

export function formatFallbackTitle(d: Date, locale: string): string {
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/**
 * Stamp for a session-list row. The group heading already names the day for
 * Today / Yesterday, so those rows show the time; within the week the weekday
 * disambiguates ("Mon 14:03"), and older rows show the date ("Oct 12").
 */
export function formatRowStamp(d: Date, locale: string, now = Date.now()): string {
  const bucket = dayBucket(d.getTime(), now)
  if (bucket === 'today' || bucket === 'yesterday') return formatTime(d, locale)
  if (bucket === 'thisWeek') {
    return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${formatTime(d, locale)}`
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
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
 * week (localized by the caller) / month-year. Items are sorted descending by
 * `startedAt` first.
 */
export function groupByDay<T extends DatedItem>(
  items: T[],
  labels: DayGroupLabels,
  locale: string
): Array<{ label: string; items: T[] }> {
  const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt)
  const out = new Map<string, T[]>()
  const now = Date.now()

  for (const s of sorted) {
    const bucket = dayBucket(s.startedAt, now)
    const label =
      bucket === 'older' ? formatGroupLabel(new Date(s.startedAt), locale) : labels[bucket]
    if (!out.has(label)) out.set(label, [])
    out.get(label)!.push(s)
  }
  return Array.from(out.entries()).map(([label, items]) => ({ label, items }))
}
