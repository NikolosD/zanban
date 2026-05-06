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
  if (jobs.length === 0) return null
  const first = jobs[0]
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground"
      title={jobs.map((j) => `${j.title} (${j.kind})`).join('\n')}
    >
      <Loader2 className="size-3 animate-spin" />
      <span>
        {t('jobs.working_other', { count: jobs.length })}
        {first ? ` · ${first.title}` : ''}
      </span>
    </div>
  )
}
