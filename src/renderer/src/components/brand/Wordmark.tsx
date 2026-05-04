import { ZanbanMark, type ZanbanMarkVariant } from './ZanbanMark'
import { cn } from '@renderer/lib/utils'

export interface WordmarkProps {
  /** Mark variant. Defaults to 'phase-dot'. */
  variant?: ZanbanMarkVariant
  /** Cap height of the wordmark. Mark scales relative to this. */
  size?: number
  /** Active state — fills the mark's signal slot. */
  signal?: string
  /** 'inline' shows mark + wordmark on one row; 'mark-only' drops the wordmark. */
  lockup?: 'inline' | 'mark-only' | 'wordmark-only'
  /** Suffix slot — typically a mono version pill. */
  suffix?: React.ReactNode
  className?: string
  fg?: string
}

/**
 * Brand lockup. Lowercase wordmark per the design system tone — Zanban
 * speaks in lowercase in app chrome ("idle", "recording 02:31"), so the
 * wordmark matches.
 */
export function Wordmark({
  variant = 'phase-dot',
  size = 14,
  signal,
  lockup = 'inline',
  suffix,
  className,
  fg
}: WordmarkProps): React.JSX.Element {
  if (lockup === 'mark-only') {
    return (
      <ZanbanMark
        variant={variant}
        size={size * 1.45}
        signal={signal}
        fg={fg}
        aria-label="Zanban"
      />
    )
  }

  return (
    <div className={cn('inline-flex items-baseline gap-2', className)}>
      {lockup === 'inline' && (
        <span
          className="relative shrink-0 self-center"
          style={{ width: size * 1.05, height: size * 1.05 }}
        >
          <ZanbanMark
            variant={variant}
            size={size * 1.05}
            signal={signal}
            fg={fg}
          />
        </span>
      )}
      <span
        className="font-semibold leading-none tracking-[-0.02em]"
        style={{ fontSize: size, color: fg }}
      >
        zanban
      </span>
      {suffix}
    </div>
  )
}
