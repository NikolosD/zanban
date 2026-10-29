import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OllamaPullProgress } from '@shared/api'
import { errorMessage } from '@renderer/lib/errors'
import { DownloadProgress } from './DownloadProgress'

export interface OllamaPull {
  pulling: string | null
  /** Progress of the running pull, once Ollama has reported any. */
  progress: OllamaPullProgress | null
  error: string | null
  pull(name: string): Promise<void>
}

/** Downloads one Ollama model at a time; `onDone` runs after each pull ends. */
export function useOllamaPull(onDone: () => void): OllamaPull {
  const { t } = useTranslation()
  const [pulling, setPulling] = useState<string | null>(null)
  const [progress, setProgress] = useState<OllamaPullProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.zanban.ollama.onPullProgress(setProgress), [])

  async function pull(name: string) {
    setPulling(name)
    setProgress(null)
    setError(null)
    try {
      const ok = await window.zanban.ollama.pull(name)
      if (!ok) setError(t('settings.providers.ollama_pull_failed', { name }))
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPulling(null)
    }
  }

  return { pulling, progress: progress?.name === pulling ? progress : null, error, pull }
}

/** Progress bar and line for the running pull, then its error if it failed. */
export function OllamaPullStatus({ pulling, progress, error }: OllamaPull) {
  return (
    <>
      {pulling && <DownloadProgress name={pulling} progress={progress} />}
      {error && <div className="text-small text-warn">{error}</div>}
    </>
  )
}
