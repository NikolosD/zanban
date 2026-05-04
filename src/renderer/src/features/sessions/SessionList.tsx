import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Play } from 'lucide-react'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { startCapturesFromSettings } from '@renderer/audio/captureController'
import { useTranscript } from '@renderer/features/transcript/store'
import { toast } from 'sonner'

async function resumeSession(id: string): Promise<void> {
  if (useTranscript.getState().session.kind === 'running') {
    toast.error('A session is already running. Stop it first.')
    return
  }
  try {
    const settings = await window.zanban.settings.get()
    await window.zanban.session.start({ resumeId: id })
    await startCapturesFromSettings(settings)
  } catch (err) {
    toast.error('Could not resume session', {
      description: err instanceof Error ? err.message : String(err)
    })
  }
}

export function SessionList({ onSelect }: { onSelect?(id: string): void } = {}) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions-local'],
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (error)
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'failed to load'}
      </p>
    )

  const items = data ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length === 0
            ? 'No sessions yet — sessions are saved locally when you stop a recording.'
            : `${items.length} session${items.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.zanban.sessions.revealFolder()}
            title="Open the sessions folder"
          >
            <FolderOpen className="size-3.5" />
            Open folder
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((s) => {
            const d = new Date(s.startedAt)
            const dur = s.durationMs
              ? `${Math.max(1, Math.round(s.durationMs / 60000))}m`
              : null
            return (
              <li key={s.id}>
                <Card className="hover:bg-accent/30 transition-colors">
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <button
                      onClick={() => onSelect?.(s.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-sm font-medium truncate">
                        {s.title ?? d.toLocaleString()}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {d.toLocaleString()}
                        {dur ? ` · ${dur}` : ''}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={s.endedAt ? 'secondary' : 'default'}
                        className="font-mono text-[10px]"
                      >
                        {s.endedAt ? 'completed' : 'in progress'}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resumeSession(s.id)}
                        title="Resume this session — new audio appends to the same file"
                      >
                        <Play className="size-3.5" />
                        Continue
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
