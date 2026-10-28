import { AlertTriangle, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CaptureNoticeKind } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { useCaptureNotices, visibleNotice } from './captureNotices'

const NOTICE_TEXT: Record<CaptureNoticeKind, string> = {
  'mic-lost': 'overlay.notices.mic_lost',
  'mic-healed': 'overlay.notices.mic_healed',
  'mic-silent': 'overlay.notices.mic_silent',
  'system-unavailable': 'overlay.notices.system_unavailable'
}

export function CaptureNoticeLine() {
  const { t } = useTranslation()
  const notice = useCaptureNotices((s) => visibleNotice(s.flags))
  if (!notice) return null
  const healed = notice === 'mic-healed'
  const text = t(NOTICE_TEXT[notice])
  return (
    <div
      role={healed ? 'status' : 'alert'}
      title={text}
      data-testid="overlay-capture-notice"
      data-notice={notice}
      className={cn(
        'mx-auto flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1',
        'bg-black/55 text-[11px] backdrop-blur-2xl backdrop-saturate-150 shadow-xl',
        healed ? 'border-white/10 text-muted-foreground' : 'border-amber-500/30 text-amber-200'
      )}
    >
      {healed ? (
        <Check className="size-3 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="size-3 shrink-0 text-amber-400" aria-hidden />
      )}
      <span className="truncate">{text}</span>
    </div>
  )
}
