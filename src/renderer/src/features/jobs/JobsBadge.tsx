import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useJobs } from './jobsStore'

/**
 * Tiny "N working" pill that appears whenever any background job is in flight
 * (RAG indexing, OCR, model pull, …). Auto-collapses when there are 0 jobs.
 */
export function JobsBadge() {
  const { t } = useTranslation()
  const jobs = useJobs((s) => s.jobs)
  const first = jobs[0]
  return (
    <div role="status">
      {first && (
        <div
          className="mr-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-muted-foreground"
          title={jobs.map((j) => j.title).join('\n')}
        >
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <span>
            {t('jobs.working', { count: jobs.length })} · {t(`jobs.kind.${first.kind}`)}
          </span>
        </div>
      )}
    </div>
  )
}
