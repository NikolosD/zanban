import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SpeechModelStatus } from '@shared/api'
import { Button } from '@renderer/components/ui/button'
import { errorMessage } from '@renderer/lib/errors'
import { DownloadProgress, formatSize } from './DownloadProgress'

/**
 * On-device recognition downloads its model at the first session otherwise,
 * so the first call would open with a wait of several minutes. `autoStart`
 * begins the download as soon as the model is found missing.
 */
export function SpeechModelDownload({ autoStart = false }: { autoStart?: boolean }) {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<SpeechModelStatus | null>(null)
  const [checks, setChecks] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.zanban.transcription.speechModel().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [checks])

  useEffect(() => window.zanban.transcription.onSpeechModelProgress(setFraction), [])

  const download = useCallback(async () => {
    setDownloading(true)
    setFraction(null)
    setError(null)
    try {
      await window.zanban.transcription.downloadSpeechModel()
    } catch (err) {
      setError(t('settings.speech_model.failed', { error: errorMessage(err) }))
    } finally {
      setDownloading(false)
      setChecks((n) => n + 1)
    }
  }, [t])

  // Once only: a failed attempt must wait for the button rather than loop.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || !status || status.installed || autoStarted.current) return
    autoStarted.current = true
    void download()
  }, [autoStart, status, download])

  if (!status) return null

  if (downloading) {
    return (
      <DownloadProgress
        name={t('settings.speech_model.name')}
        progress={
          fraction === null
            ? null
            : { completed: fraction * status.missingBytes, total: status.missingBytes }
        }
      />
    )
  }

  if (status.installed) {
    return (
      <span className="flex items-center gap-1 text-small text-success">
        <CheckCircle2 className="size-3 shrink-0" />
        {t('settings.speech_model.installed')}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 self-start"
        onClick={() => void download()}
      >
        <Download className="size-3" />
        {t('settings.speech_model.download', {
          size: formatSize(status.missingBytes, i18n.language)
        })}
      </Button>
      {error && <div className="text-small text-warn">{error}</div>}
    </div>
  )
}
