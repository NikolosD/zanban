import { useTranslation } from 'react-i18next'

// Decimal units, as Ollama's own CLI and model pages count them. A fixed digit
// after the point keeps the line from jittering as the numbers grow.
export function formatSize(bytes: number, locale: string): string {
  const gigabytes = bytes >= 1e9
  const digits = gigabytes ? 1 : 0
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: gigabytes ? 'gigabyte' : 'megabyte',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(gigabytes ? bytes / 1e9 : bytes / 1e6)
}

/** Bar and "2.0 GB of 6.6 GB (30%)" line for a running download of `name`. */
export function DownloadProgress({
  name,
  progress
}: {
  name: string
  /** Bytes so far; null until the first report. */
  progress: { completed: number; total: number } | null
}) {
  const { t, i18n } = useTranslation()
  const percent = progress ? Math.floor((progress.completed / progress.total) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={t('settings.providers.ollama_pull_title', { name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-small text-muted-foreground">
        {progress
          ? t('settings.providers.ollama_pull_progress', {
              name,
              done: formatSize(progress.completed, i18n.language),
              total: formatSize(progress.total, i18n.language),
              percent
            })
          : t('settings.providers.ollama_pull_starting', { name })}
      </span>
    </div>
  )
}
