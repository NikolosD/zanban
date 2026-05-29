import { useEffect, useMemo, useRef } from 'react'
import { Ear } from 'lucide-react'
import { useTranscript } from '@renderer/features/transcript/store'
import { cn } from '@renderer/lib/utils'
import { buildLane, type LaneItem } from './rollingLane'

const SYSTEM_LIMIT = 40

export function RollingTranscript() {
  const session = useTranscript((s) => s.session)
  const finals = useTranscript((s) => s.finals)
  const partial = useTranscript((s) => s.partials.system)
  const systemFinals = useMemo(() => finals.filter((f) => f.channel === 'system'), [finals])

  const lane = useMemo(
    () => buildLane({ finals: systemFinals, partial, limit: SYSTEM_LIMIT }),
    [systemFinals, partial]
  )

  // Single-line strip with no "stick to bottom" mode — every content change pins
  // the scroll position to the right edge so the freshest text stays in view.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const signature = lane.map((l) => `${l.id}:${l.text.length}`).join('|')
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [signature])

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
        className="flex-1 min-w-0 overflow-x-hidden whitespace-nowrap text-[12px] leading-6 italic"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'
        }}
      >
        {lane.length === 0 ? (
          <span className="text-muted-foreground/60">listening…</span>
        ) : (
          lane.map((item, idx) => (
            <span key={item.id}>
              {idx > 0 && (
                <span className="px-1 text-muted-foreground/30" aria-hidden>
                  ·
                </span>
              )}
              <SegmentSpan item={item} />
            </span>
          ))
        )}
      </div>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-emerald-400/70 motion-safe:animate-pulse"
      />
    </div>
  )
}

function SegmentSpan({ item }: { item: LaneItem }) {
  if (!item.isFinal) {
    return (
      <span className="text-muted-foreground/70">
        {item.text}
        <span className="text-muted-foreground/60">▍</span>
      </span>
    )
  }
  return <span className="text-foreground/85">{item.text}</span>
}
