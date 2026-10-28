import { useMemo } from 'react'
import { Ear } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AudioChannel } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { buildLane } from './rollingLane'

/**
 * One static line with the latest thing heard. It never scrolls sideways: a
 * long line truncates, so streaming partials don't drag the eye during a call.
 */
export function RollingTranscript() {
  const { t } = useTranslation()
  const running = useTranscript((s) => s.session.kind === 'running')
  const finals = useTranscript((s) => s.finals)
  const partials = useTranscript((s) => s.partials)
  const micError = useTranscript((s) => s.status.mic?.kind === 'error')
  const systemError = useTranscript((s) => s.status.system?.kind === 'error')

  const latest = useMemo(() => buildLane({ finals, partials, limit: 1 }).at(0), [finals, partials])

  if (!running) return null

  return (
    <div
      data-interactive
      data-testid="overlay-rolling-transcript"
      className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] leading-5"
    >
      <Ear className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <p className="min-w-0 flex-1 truncate" title={latest?.text}>
        {latest ? (
          <>
            <span className="mr-1.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
              {latest.channel === 'mic' ? t('overlay.rolling.you') : t('overlay.rolling.them')}
            </span>
            <span className={latest.live ? 'text-foreground/55' : 'text-foreground/85'}>
              {latest.text}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground/60">{t('overlay.rolling.listening')}</span>
        )}
      </p>
      {micError && <CaptureErrorDot channel="mic" />}
      {systemError && <CaptureErrorDot channel="system" />}
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
