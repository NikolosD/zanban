import { useEffect, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { useTranscript } from './store'
import {
  startCapturesFromSettings,
  stopCaptures,
  wireCaptureAutostop
} from '@renderer/audio/captureController'
import { Button } from '@renderer/components/ui/button'
import { toast } from 'sonner'

export function SessionControl() {
  const session = useTranscript((s) => s.session)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = wireCaptureAutostop()
    return () => off()
  }, [])

  async function handleStart() {
    setBusy(true)
    try {
      const settings = await window.zanban.settings.get()
      await window.zanban.session.start()
      await startCapturesFromSettings(settings)
    } catch (err) {
      toast.error('Could not start session', {
        description: err instanceof Error ? err.message : String(err)
      })
      stopCaptures()
      await window.zanban.session.stop().catch(() => {})
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
      {running ? 'Stop' : 'Start session'}
    </Button>
  )
}
