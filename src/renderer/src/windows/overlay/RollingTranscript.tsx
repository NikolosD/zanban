import { useMemo } from 'react'
import { Ear } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AudioChannel } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { cn } from '@renderer/lib/utils'
import { buildLane } from './rollingLane'
import { useTranscriptWorthShowing } from './useTranscriptWorthShowing'

/**
 * One static line with the latest thing heard. It never scrolls sideways: a
 * long line truncates, so streaming partials don't drag the eye during a call.
 * It opens only while the other side is speaking or a question waits for an
 * answer, then folds away; capture errors and start-up progress keep it open.
 */
export function RollingTranscript() {
  const { t } = useTranslation()
  const running = useTranscript((s) => s.session.kind === 'running')
  const finals = useTranscript((s) => s.finals)
  const partials = useTranscript((s) => s.partials)
  const micError = useTranscript((s) => s.status.mic?.kind === 'error')
  const systemError = useTranscript((s) => s.status.system?.kind === 'error')
  // undefined: speech recognition is up; null: connecting; a number: model download share.
  const loading = useTranscript((s) => {
    const status = [s.status.mic, s.status.system].find((st) => st?.kind === 'connecting')
    return status?.kind === 'connecting' ? (status.progress ?? null) : undefined
  })

  const worthShowing = useTranscriptWorthShowing()
  const latest = useMemo(() => buildLane({ finals, partials, limit: 1 }).at(0), [finals, partials])

  if (!running) return null

  const open = worthShowing || micError || systemError || loading !== undefined

  return (
    <div
      data-interactive
      data-testid="overlay-rolling-transcript"
      data-open={open}
      aria-hidden={!open}
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] border-y-0'
      )}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] leading-5">
          <Ear className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 truncate" title={latest?.text}>
            {latest ? (
              <>
                <span className="mr-1.5 font-mono text-meta uppercase tracking-wide text-muted-foreground">
                  {latest.channel === 'mic' ? t('overlay.rolling.you') : t('overlay.rolling.them')}
                </span>
                <span className={latest.live ? 'text-foreground/70' : 'text-foreground/90'}>
                  {latest.text}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {loading === undefined
                  ? t('overlay.rolling.listening')
                  : loading === null
                    ? t('overlay.rolling.connecting')
                    : t('overlay.rolling.downloading_model', {
                        percent: Math.round(loading * 100)
                      })}
              </span>
            )}
          </p>
          {micError && <CaptureErrorDot channel="mic" />}
          {systemError && <CaptureErrorDot channel="system" />}
        </div>
      </div>
    </div>
  )
}

function CaptureErrorDot({ channel }: { channel: AudioChannel }) {
  const { t } = useTranslation()
  const label =
    channel === 'mic' ? t('overlay.rolling.mic_label') : t('overlay.rolling.system_label')
  const title = t('overlay.rolling.state_error', { label })
  return (
    <span
      role="status"
      aria-label={title}
      title={title}
      data-channel={channel}
      data-state="error"
      className="size-1.5 shrink-0 rounded-full bg-destructive"
    />
  )
}
