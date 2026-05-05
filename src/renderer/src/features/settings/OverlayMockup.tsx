import { Square, EyeOff, X, Send, ChevronDown } from 'lucide-react'
import { ZanbanMark } from '@renderer/components/brand'
import { Kbd } from '@renderer/components/ui/kbd'
import { cn } from '@renderer/lib/utils'

/**
 * Static, presentational replica of the overlay's running state — used in
 * Settings → Appearance to preview Interface Opacity. Mirrors the JSX/classes
 * in OverlayApp.tsx 1:1 so the user judges opacity against the actual chrome,
 * not a stylized approximation.
 *
 * Maintenance note: when OverlayApp's render structure changes (status pill,
 * merged panel layout, action chips, input row), update this file too. There
 * is no automated drift check.
 */
export function OverlayMockup(): React.JSX.Element {
  return (
    <div className="pointer-events-none p-3" style={{ width: 680 }}>
      <div
        className={cn(
          'pointer-events-auto mx-auto flex w-full flex-col gap-1.5',
          'max-w-[680px]'
        )}
      >
        <MockStatusBar />
        <div
          className={cn(
            'flex flex-col rounded-2xl border border-white/10',
            'bg-black/55 backdrop-blur-2xl backdrop-saturate-150 text-foreground',
            'shadow-2xl overflow-hidden'
          )}
        >
          <MockChipsRow />
          <MockInputRow />
          <MockAnswerSection />
        </div>
      </div>
    </div>
  )
}

function MockStatusBar() {
  return (
    <div
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border border-white/10',
        'bg-black/55 px-2 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
    >
      <button
        type="button"
        className={cn(
          'flex h-7 w-7 -translate-y-px items-center justify-center rounded-full',
          'text-foreground'
        )}
      >
        <ZanbanMark size={18} signal="oklch(0.72 0.18 25)" />
      </button>
      <div className="flex items-center gap-1">
        {/* Recording chip — running state */}
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5',
            'border border-primary/30 bg-primary/10 font-mono text-[10px] text-primary'
          )}
        >
          <span className="inline-flex size-1.5 rounded-full bg-primary" />
          02:31
          <Square className="ml-0.5 size-2.5 fill-current" />
        </button>
        {/* Stealth on label */}
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded px-2 font-mono text-[11px] lowercase tracking-tight',
            'text-muted-foreground'
          )}
        >
          <EyeOff className="size-3" />
          <span>stealth on</span>
        </button>
        {/* Hotkey hint */}
        <span className="inline-flex items-center gap-1 px-1 font-mono text-[10px] tabular-nums">
          <span className="text-muted-foreground/55">⌃⇧</span>
          <span className="text-muted-foreground">␣</span>
          <span className="text-muted-foreground/40">ask</span>
        </span>
        {/* Close */}
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  )
}

function MockChipsRow() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2">
      <Chip>Recap</Chip>
      <Chip trailing={<ChevronDown className="size-3 opacity-60" />}>more</Chip>
      <span className="flex-1" />
      <Chip emphasis>Answer</Chip>
    </div>
  )
}

function Chip({
  children,
  emphasis,
  trailing
}: {
  children: React.ReactNode
  emphasis?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px]',
        emphasis
          ? 'bg-foreground text-background font-medium'
          : 'border border-white/10 bg-white/[0.04] text-foreground/85'
      )}
    >
      {children}
      {trailing}
    </span>
  )
}

function MockInputRow() {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
      <span className="flex-1 truncate py-1 text-[13px] text-muted-foreground/60">
        Ask anything on screen or conversation, or
      </span>
      {/* model picker */}
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground">
        <span className="max-w-[110px] truncate">Default</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </span>
      {/* snap hotkey badge */}
      <span
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-md border border-white/10',
          'bg-white/5 px-1.5 font-mono text-[10px] text-muted-foreground'
        )}
      >
        <Kbd>⌘</Kbd>
        <span>+</span>
        <Kbd>H</Kbd>
      </span>
      {/* send */}
      <button
        type="button"
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
          'bg-foreground text-background'
        )}
      >
        <Send className="size-3.5" />
      </button>
    </div>
  )
}


function MockAnswerSection() {
  return (
    <div className="flex flex-col gap-2 border-t border-white/10 px-3 py-2.5">
      {/* detected-question chip */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            'inline-flex max-w-[420px] items-center gap-1.5 rounded-md',
            'border border-primary/40 bg-primary/10 px-2 py-1 text-[11px]'
          )}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="truncate">How do you handle reconciliation when streams disagree?</span>
          <span className="ml-1 shrink-0 rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-primary">
            answer ↵
          </span>
        </span>
      </div>

      {/* answer body */}
      <div className="px-1 py-1">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          Answer last question
        </div>
        <div className="mt-2 text-[13px] leading-relaxed text-foreground">
          We resolve disagreement by treating system-audio as authoritative for
          what the room said, and the mic channel for what <em>you</em> said.
          The reconciler diffs both streams every 800 ms.
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-accent" />
          done · 920 ms · 184 tok
        </div>
      </div>
    </div>
  )
}
