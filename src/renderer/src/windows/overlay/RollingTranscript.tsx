import { useEffect, useMemo, useRef, useState } from 'react'
import { Ear } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AudioChannel } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { onLevel } from '@renderer/audio/level'
import { cn } from '@renderer/lib/utils'
import { buildLane, type LaneItem } from './rollingLane'
import { deriveChannelState, MIC_PEAK_THRESHOLD, type CaptureState } from './captureHealth'

// Keep the combined lane bounded. Two channels share the budget now, so a
// slightly larger cap than the old system-only 40 keeps a comparable amount of
// each speaker's recent words on screen.
const LANE_LIMIT = 48

export function RollingTranscript() {
  const { t } = useTranslation()
  const session = useTranscript((s) => s.session)
  const finals = useTranscript((s) => s.finals)
  const partials = useTranscript((s) => s.partials)
  const status = useTranscript((s) => s.status)

  const lane = useMemo(() => buildLane({ finals, partials, limit: LANE_LIMIT }), [finals, partials])

  // Single-line strip with no "stick to bottom" mode — every content change pins
  // the scroll position to the right edge so the freshest text stays in view.
  // The signature includes partial text so the live tail keeps scrolling into
  // view as it grows, not only when a segment finalizes.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const signature = lane.map((l) => `${l.id}:${l.live ? l.text.length : ''}`).join('|')
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [signature])

  // Per-channel last-activity, derived from the segments the overlay actually
  // receives over IPC. Both finals and partials carry a real wall-clock
  // `createdAt`, so the most recent one per channel tells us when we last heard
  // that speaker — which is what drives the "speaking" dot.
  const micActivityAt = useChannelActivity('mic', finals, partials)
  const systemActivityAt = useChannelActivity('system', finals, partials)

  // Live mic peak. The capture pipeline (and thus the AnalyserNode behind
  // onLevel) usually lives in the dashboard renderer, so in the overlay window
  // this stays at 0 and the dot relies on transcript activity instead. We still
  // subscribe defensively + throttled so it lights up immediately if capture
  // ever runs in this window. Throttling avoids a per-frame React re-render.
  const micPeak = useThrottledMicPeak()

  // Tick a coarse clock so a channel's dot relaxes from "speaking" back to
  // "idle" after the window elapses, without re-deriving on every audio frame.
  const now = useCoarseClock(session.kind === 'running')

  const micState = deriveChannelState('mic', {
    status: status.mic,
    lastActivityAt: micActivityAt,
    micPeak,
    now
  })
  const systemState = deriveChannelState('system', {
    status: status.system,
    lastActivityAt: systemActivityAt,
    now
  })

  if (session.kind !== 'running') return null

  return (
    <div
      data-interactive
      data-testid="overlay-rolling-transcript"
      className={cn(
        'mx-auto flex w-full max-w-[680px] items-center gap-2',
        'rounded-full border border-white/10',
        'bg-black/55 px-3 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
    >
      <Ear className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <div
        ref={scrollerRef}
        className="flex-1 min-w-0 overflow-x-hidden whitespace-nowrap text-[12px] leading-6"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 12%, black 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 12%, black 100%)'
        }}
      >
        {lane.length === 0 ? (
          <span className="text-muted-foreground/60 italic">{t('overlay.rolling.listening')}</span>
        ) : (
          lane.map((item, idx) => <LaneSpan key={item.id} item={item} showDot={idx > 0} t={t} />)
        )}
      </div>
      {/* Per-channel capture-health dots. Lets the user confirm "it can hear
          me / them" BEFORE any text shows up, so a silent run is caught early. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <HealthDot channel="mic" state={micState} t={t} />
        <HealthDot channel="system" state={systemState} t={t} />
      </div>
    </div>
  )
}

function LaneSpan({
  item,
  showDot,
  t
}: {
  item: LaneItem
  showDot: boolean
  t: ReturnType<typeof useTranslation>['t']
}) {
  const who = item.channel === 'mic' ? t('overlay.rolling.you') : t('overlay.rolling.them')
  return (
    <span>
      {showDot && (
        <span className="px-1 text-muted-foreground/30" aria-hidden>
          ·
        </span>
      )}
      {/* Speaker tag — "You" (mic) reads warm, "Them" (system) cool, so the two
          sides are separable at a glance on a single line. */}
      <span
        className={cn(
          'mr-1 font-mono text-[9px] uppercase tracking-wide',
          item.channel === 'mic' ? 'text-sky-300/70' : 'text-violet-300/70'
        )}
      >
        {who}
      </span>
      <span
        className={cn(
          'italic',
          // The live (non-final) partial is dimmed + carries a soft cursor so
          // the line visibly "types" instead of snapping on finalization.
          item.live ? 'text-foreground/45' : 'text-foreground/85'
        )}
      >
        {item.text}
        {item.live && <span className="text-foreground/30">▍</span>}
      </span>
    </span>
  )
}

const DOT_CLASS: Record<CaptureState, string> = {
  idle: 'bg-muted-foreground/40',
  connecting: 'bg-amber-400/70 motion-safe:animate-pulse',
  speaking: 'bg-emerald-400/80 motion-safe:animate-pulse',
  error: 'bg-red-400/80'
}

function HealthDot({
  channel,
  state,
  t
}: {
  channel: AudioChannel
  state: CaptureState
  t: ReturnType<typeof useTranslation>['t']
}) {
  const label =
    channel === 'mic' ? t('overlay.rolling.mic_label') : t('overlay.rolling.system_label')
  const title = t(`overlay.rolling.state_${state}`, { label })
  return (
    <span
      role="status"
      aria-label={title}
      title={title}
      data-channel={channel}
      data-state={state}
      className={cn('size-1.5 rounded-full', DOT_CLASS[state])}
    />
  )
}

/**
 * Most-recent wall-clock activity for one channel. A live partial (if present)
 * is always the freshest signal; otherwise we fall back to the channel's last
 * final. Memoized so it only recomputes when the underlying segments change.
 */
function useChannelActivity(
  channel: AudioChannel,
  finals: ReturnType<typeof useTranscript.getState>['finals'],
  partials: ReturnType<typeof useTranscript.getState>['partials']
): number | null {
  return useMemo(() => {
    const partial = partials[channel]
    if (partial && partial.text.trim().length > 0) return partial.createdAt
    for (let i = finals.length - 1; i >= 0; i--) {
      if (finals[i]!.channel === channel) return finals[i]!.createdAt
    }
    return null
  }, [channel, finals, partials])
}

/**
 * Coarse 300ms clock, only ticking while running. Drives the speaking→idle
 * relaxation without re-rendering on every audio frame; when stopped the
 * interval is torn down so paused overlays don't keep timers alive (the
 * component renders null in that case anyway, so the stale value is unused).
 */
function useCoarseClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 300)
    return () => clearInterval(id)
  }, [active])
  return now
}

/**
 * Mic peak smoothed to a discrete above/below-threshold boolean and surfaced as
 * 0 or 1. We only flip React state on threshold crossings (not every frame) so
 * the loud-mic fast-path can't cause a render storm.
 */
function useThrottledMicPeak(): number {
  const [loud, setLoud] = useState(false)
  const loudRef = useRef(false)
  useEffect(() => {
    return onLevel((level) => {
      const next = level >= MIC_PEAK_THRESHOLD
      if (next !== loudRef.current) {
        loudRef.current = next
        setLoud(next)
      }
    })
  }, [])
  return loud ? 1 : 0
}
