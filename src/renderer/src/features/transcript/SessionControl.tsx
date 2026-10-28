import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Square, Loader2 } from 'lucide-react'
import { useTranscript } from './store'
import { stopCaptures, wireCaptureAutostop } from '@renderer/audio/captureController'
import { Button } from '@renderer/components/ui/button'
import { startSessionWithCapture, toastSessionError } from './sessionStart'

export function SessionControl() {
  const { t } = useTranslation()
  const session = useTranscript((s) => s.session)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = wireCaptureAutostop()
    return () => off()
  }, [])

  async function handleStart() {
    setBusy(true)
    try {
      await startSessionWithCapture()
    } catch (err) {
      toastSessionError(t('dashboard.toasts.could_not_start'), err)
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      stopCaptures()
      await window.zanban.session.stop()
    } finally {
      setBusy(false)
    }
  }

  const running = session.kind === 'running'

  return (
    <Button
      onClick={running ? handleStop : handleStart}
      disabled={busy}
      variant={running ? 'outline' : 'default'}
      size="sm"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : running ? (
        <Square className="size-3.5 fill-current" />
      ) : (
        <Mic className="size-3.5" />
      )}
      {running ? t('dashboard.stop_session') : t('dashboard.start_session')}
    </Button>
  )
}
