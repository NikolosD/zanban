import { useEffect, useMemo, useRef } from 'react'
import { Mic } from 'lucide-react'
import { useTranscript } from './store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import type { AudioChannel, TranscriptSegment } from '@shared/types'

interface Line {
  id: string
  channel: AudioChannel
  text: string
  isFinal: boolean
}

export function LiveTranscript({
  limit = 30,
  className
}: {
  limit?: number
  className?: string
}) {
  const finals = useTranscript((s) => s.finals)
  const partials = useTranscript((s) => s.partials)
  const session = useTranscript((s) => s.session)
  const ref = useRef<HTMLDivElement>(null)

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = finals.slice(-limit).map((s: TranscriptSegment) => ({
      id: s.id,
      channel: s.channel,
      text: s.text,
      isFinal: true
    }))
    for (const ch of ['mic', 'system'] as const) {
      const p = partials[ch]
      if (p) out.push({ id: `${ch}-partial`, channel: ch, text: p.text, isFinal: false })
    }
    return out
  }, [finals, partials, limit])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const viewport = el.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    const target = viewport ?? el
    target.scrollTop = target.scrollHeight
  }, [lines])

  const empty = lines.length === 0
  const running = session.kind === 'running'

  return (
    <ScrollArea ref={ref} className={cn('min-h-0', className)}>
      {empty ? (
        <Empty running={running} />
      ) : (
        <div className="flex flex-col gap-1.5 pr-2">
          {lines.map((l) => (
            <Line key={l.id + (l.isFinal ? '_f' : '_p')} line={l} />
          ))}
        </div>
      )}
    </ScrollArea>
  )
}

function Line({ line }: { line: Line }) {
  const isYou = line.channel === 'mic'
  return (
    <div className="flex items-start gap-2 leading-snug">
      <span
        className={cn(
          'mt-0.5 shrink-0 select-none font-mono text-[9px] font-semibold uppercase tracking-wider',
          isYou ? 'text-blue-400' : 'text-orange-400'
        )}
        style={{ width: 32 }}
      >
        {isYou ? 'You' : 'Them'}
      </span>
      <span
        className={cn(
          'flex-1 text-[13px]',
          line.isFinal ? 'text-foreground' : 'italic text-muted-foreground'
        )}
      >
        {line.text}
        {!line.isFinal && <span className="text-muted-foreground/60">▍</span>}
      </span>
    </div>
  )
}

function Empty({ running }: { running: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 opacity-60">
      <Mic className="size-4 text-muted-foreground" />
      <span className="font-mono text-[11px] text-muted-foreground">
        {running ? 'listening…' : 'press start to begin'}
      </span>
    </div>
  )
}
