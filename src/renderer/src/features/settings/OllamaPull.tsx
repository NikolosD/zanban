import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OllamaPullProgress } from '@shared/api'
import { errorMessage } from '@renderer/lib/errors'

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

// Decimal units, as Ollama's own CLI and model pages count them. A fixed digit
// after the point keeps the line from jittering as the numbers grow.
function formatSize(bytes: number, locale: string): string {
  const gigabytes = bytes >= 1e9
  const digits = gigabytes ? 1 : 0
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: gigabytes ? 'gigabyte' : 'megabyte',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(gigabytes ? bytes / 1e9 : bytes / 1e6)
}

/** Progress bar and line for the running pull, then its error if it failed. */
export function OllamaPullStatus({ pulling, progress, error }: OllamaPull) {
  const { t, i18n } = useTranslation()
  const percent = progress ? Math.floor((progress.completed / progress.total) * 100) : 0
  return (
    <>
      {pulling && (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={t('settings.providers.ollama_pull_title', { name: pulling })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-small text-muted-foreground">
            {progress
              ? t('settings.providers.ollama_pull_progress', {
                  name: pulling,
                  done: formatSize(progress.completed, i18n.language),
                  total: formatSize(progress.total, i18n.language),
                  percent
                })
              : t('settings.providers.ollama_pull_starting', { name: pulling })}
          </span>
        </div>
      )}
      {error && <div className="text-small text-warn">{error}</div>}
    </>
  )
}
