import { cn } from '@renderer/lib/utils'

export type ProviderDotStatus = 'ok' | 'missing' | 'unknown' | 'error'

const STYLES: Record<ProviderDotStatus, string> = {
  ok: 'bg-emerald-400 shadow-[0_0_0_2px_oklch(0.78_0.13_145/0.2)]',
  missing: 'bg-muted-foreground/40',
  unknown: 'bg-muted-foreground/40',
  error: 'bg-red-500 shadow-[0_0_0_2px_oklch(0.6_0.2_25/0.25)]'
}

// "ok" means the credential is configured (key string present) — NOT that it
// was verified with a live call. Use the per-card "Test" button to verify.
const TITLES: Record<ProviderDotStatus, string> = {
  ok: 'Configured — use Test to verify',
  missing: 'Not configured',
  unknown: 'Status unknown',
  error: 'Last attempt failed'
}

/**
 * Small colored dot that summarizes provider readiness at a glance. Today the
 * status is derived from "is the credential configured?" — once we add a
 * polling health-check we can flip the same dot to green/red on success or
 * failure of a real ping. The component intentionally doesn't fetch anything
 * itself so it stays cheap to embed in lists.
 */
export function ProviderStatusDot({
  status,
  title,
  className
}: {
  status: ProviderDotStatus
  title?: string
  className?: string
}) {
  return (
    <span
      title={title ?? TITLES[status]}
      aria-label={title ?? TITLES[status]}
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full transition-colors',
        STYLES[status],
        className
      )}
    />
  )
}
