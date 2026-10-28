import { Square, EyeOff, X, Send, ChevronDown, Ear, Camera, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ZanbanMark } from '@renderer/components/brand'
import { cn } from '@renderer/lib/utils'
import { GLASS_PANEL, GLASS_PILL, overlayGlassVars } from '@renderer/windows/overlay/glass'

/**
 * Static, presentational replica of the overlay's running state — used in
 * Settings → Appearance to preview Interface Opacity. Mirrors the JSX/classes
 * in OverlayApp.tsx so the user judges the glass against the actual chrome.
 * `opacity` drives only the glass alpha, exactly like the overlay: the host
 * must not fade this element itself, or the text fades with it.
 *
 * Maintenance note: when OverlayApp's render structure changes (status pill,
 * answer pane, transcript row, action chips, input row), update this file
 * too. There is no automated drift check.
 */
export function OverlayMockup({ opacity = 1 }: { opacity?: number }): React.JSX.Element {
  return (
    <div className="pointer-events-none p-3" style={{ width: 680, ...overlayGlassVars(opacity) }}>
      <div
        className={cn('pointer-events-auto mx-auto flex w-full flex-col gap-1.5', 'max-w-[680px]')}
      >
        <MockStatusBar />
        <div
          className={cn(
            'flex flex-col divide-y divide-white/10 rounded-2xl border border-white/10',
            GLASS_PANEL,
            'text-foreground shadow-2xl overflow-hidden'
          )}
        >
          <MockAnswerSection />
          <MockTranscriptRow />
          <MockChipsRow />
          <MockInputRow />
        </div>
      </div>
    </div>
  )
}

function MockStatusBar() {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border border-white/10 px-2 py-1 shadow-xl',
        GLASS_PILL
      )}
    >
      <span className="flex h-7 w-7 -translate-y-px items-center justify-center rounded-full text-foreground">
        <ZanbanMark size={18} signal="oklch(0.72 0.18 25)" />
      </span>
      <div className="flex items-center gap-1">
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5',
            'border border-signal/30 bg-signal/10 font-mono text-small text-signal'
          )}
        >
          <span className="inline-flex size-1.5 rounded-full bg-signal" />
          02:31
          <Square className="ml-0.5 size-2.5 fill-current" />
        </span>
        <span className="inline-flex h-6 items-center gap-1 px-2 font-mono text-small lowercase tracking-tight text-muted-foreground">
          <EyeOff className="size-3" />
          <span>{t('overlay.stealth_on')}</span>
        </span>
        <span className="inline-flex size-6 items-center justify-center text-muted-foreground">
          <X className="size-3" />
        </span>
      </div>
    </div>
  )
}

function MockAnswerSection() {
  const { t } = useTranslation()
  return (
    <div className="px-3 py-2.5">
      <div className="space-y-1.5 px-1 py-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-small text-muted-foreground">
            {t('overlay.labels.answer_last')}
          </div>
          <Copy className="size-3 text-muted-foreground/70" />
        </div>
        <div className="max-w-[65ch] text-[14px] leading-[1.5] text-foreground">
          {t('overlay.preview.answer')}
        </div>
      </div>
    </div>
  )
}

function MockTranscriptRow() {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] leading-5">
      <Ear className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <span className="mr-1.5 font-mono text-meta uppercase tracking-wide text-muted-foreground">
          {t('overlay.rolling.them')}
        </span>
        <span className="text-foreground/90">{t('overlay.preview.heard')}</span>
      </p>
    </div>
  )
}

function MockChipsRow() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2">
      <Chip>{t('overlay.chips.catch_up')}</Chip>
      <Chip trailing={<ChevronDown className="size-3 opacity-60" />}>{t('overlay.more')}</Chip>
      <span className="flex-1" />
      <Chip emphasis>{t('overlay.chips.answer')}</Chip>
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
        'inline-flex h-7 items-center gap-1 rounded-full px-3 text-small',
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
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex-1 truncate py-1 text-body text-muted-foreground">
        {t('overlay.ask_placeholder')}
      </span>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground">
        <Camera className="size-3.5" />
      </span>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground">
        <Send className="size-3.5" />
      </span>
    </div>
  )
}
