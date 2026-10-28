import { AlertTriangle, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CaptureNoticeKind } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { useCaptureNotices, visibleNotice } from './captureNotices'
import { RollingTranscript } from './RollingTranscript'

const NOTICE_TEXT: Record<CaptureNoticeKind, string> = {
  'mic-lost': 'overlay.notices.mic_lost',
  'mic-healed': 'overlay.notices.mic_healed',
  'mic-silent': 'overlay.notices.mic_silent',
  'system-unavailable': 'overlay.notices.system_unavailable'
}

/**
 * The one-line row under the answer: a capture problem or transcription error
 * while there is one, the live transcript otherwise. Problems take over this
 * fixed-height row instead of appearing above the answer, so a notice coming
 * or going never shifts the text the user is reading.
 */
export function TranscriptOrNotice({ error }: { error: string | null }) {
  const { t } = useTranslation()
  const notice = useCaptureNotices((s) => visibleNotice(s.flags))
  if (!notice && !error) return <RollingTranscript />
  const healed = notice === 'mic-healed'
  const text = notice ? t(NOTICE_TEXT[notice]) : (error ?? '')
  return (
    <div
      role={healed ? 'status' : 'alert'}
      title={text}
      data-testid="overlay-capture-notice"
      data-notice={notice ?? 'transcription-error'}
      className={cn(
        'flex min-w-0 items-center gap-2 px-3 py-1.5 text-[12px] leading-5',
        healed ? 'text-muted-foreground' : notice ? 'text-amber-200' : 'text-red-300'
      )}
    >
      {healed ? (
        <Check className="size-3 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle
          className={cn('size-3 shrink-0', notice ? 'text-amber-400' : 'text-red-400')}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  )
}
