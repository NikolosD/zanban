import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Play } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { startCapturesFromSettings } from '@renderer/audio/captureController'
import { useTranscript } from '@renderer/features/transcript/store'
import { toast } from 'sonner'
import i18n from 'i18next'

async function resumeSession(id: string): Promise<void> {
  if (useTranscript.getState().session.kind === 'running') {
    toast.error(i18n.t('session_list.session_running'))
    return
  }
  try {
    const settings = await window.zanban.settings.get()
    await window.zanban.session.start({ resumeId: id })
    await startCapturesFromSettings(settings)
  } catch (err) {
    toast.error(i18n.t('session_list.could_not_resume'), {
      description: err instanceof Error ? err.message : String(err)
    })
  }
}

export function SessionList({ onSelect }: { onSelect?(id: string): void } = {}) {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions-local'],
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('dashboard.loading')}</p>
  if (error)
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('dashboard.load_failed')}
      </p>
    )

  const items = data ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length === 0
            ? t('session_list.no_sessions')
            : t('session_list.count_other', { count: items.length })}
        </p>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.zanban.sessions.revealFolder()}
            title={t('session_list.open_folder_tooltip')}
          >
            <FolderOpen className="size-3.5" />
            {t('session_list.open_folder')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            {t('session_list.refresh')}
          </Button>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((s, i) => {
            const d = new Date(s.startedAt)
            const dur = s.durationMs ? `${Math.max(1, Math.round(s.durationMs / 60000))}m` : null
            const isLive = !s.endedAt
            const isLast = i === items.length - 1
            return (
              <li key={s.id} className={cn(!isLast && 'border-b border-white/[0.045]')}>
                <div className="group flex items-center gap-4 px-1 py-3 transition-colors hover:bg-white/[0.025]">
                  <span className="flex w-2.5 shrink-0 items-center justify-center">
                    {isLive && (
                      <span className="size-1.5 rounded-full bg-primary motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]" />
                    )}
                  </span>
                  <button onClick={() => onSelect?.(s.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13.5px] font-medium text-foreground">
                      {s.title ?? d.toLocaleString()}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/65">
                      {d.toLocaleString()}
                      {dur ? ` · ${dur}` : ''}
                    </div>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => void resumeSession(s.id)}
                    title={t('session_list.resume_tooltip')}
                  >
                    <Play className="size-3.5" />
                    {t('session_list.continue')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
