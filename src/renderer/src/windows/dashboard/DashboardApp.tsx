import { useEffect, useMemo, useState } from 'react'
import { Settings as SettingsIcon, Sparkles, Search, Mic, Square, Loader2, Play } from 'lucide-react'
import { SessionDetail } from '@renderer/features/sessions/SessionDetail'
import {
  SettingsPanel,
  SETTINGS_TABS,
  type SettingsTabId
} from '@renderer/features/settings/SettingsPanel'
import { AskPanel } from '@renderer/features/ai/AskPanel'
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { wireAiIpc } from '@renderer/features/ai/store'
import {
  startCapturesFromSettings,
  stopCaptures,
  wireCaptureAutostop
} from '@renderer/audio/captureController'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@renderer/components/ui/dialog'
import { Toaster } from '@renderer/components/ui/sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'

type SessionListItem = {
  id: string
  title?: string | null
  startedAt: number
  endedAt?: number | null
  durationMs?: number | null
}

export function DashboardApp() {
  const [version, setVersion] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general')
  const [askKey, setAskKey] = useState(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    void window.zanban.getVersion().then(setVersion)
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    // The session list is loaded via React Query and the dashboard window
    // never loses focus when a session ends in the overlay — so without an
    // explicit invalidation the user would only see the new session after a
    // manual refresh / page reload. Refetching the moment the session goes
    // back to idle closes that gap.
    const offSession = window.zanban.session.onState((state) => {
      if (state.kind === 'idle') {
        void queryClient.invalidateQueries({ queryKey: ['sessions-local'] })
      }
    })
    return () => {
      offTr()
      offAi()
      offSession()
    }
  }, [queryClient])

  if (selected) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-4xl px-10 pt-8 pb-8">
          <SessionDetail sessionId={selected} onBack={() => setSelected(null)} />
        </main>
        <Toaster richColors theme="dark" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-5xl px-10 pt-10 pb-16">
        <Header
          version={version}
          onAsk={() => {
            setAskKey((k) => k + 1)
            setAskOpen(true)
          }}
          onSelectSession={setSelected}
          onOpenSettingsTab={(t) => {
            setSettingsTab(t)
            setSettingsOpen(true)
          }}
          onSettings={() => {
            setSettingsTab('general')
            setSettingsOpen(true)
          }}
        />
        <div className="mt-10">
          <MeetingsList onSelect={setSelected} />
        </div>
      </main>

      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">Ask</DialogTitle>
          <DialogDescription className="sr-only">
            Ask anything about the current call.
          </DialogDescription>
          <div className="p-4 h-[520px]">
            <AskPanel autoFocusKey={askKey} className="h-full" />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden gap-0 h-[640px]">
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            API keys, audio devices, hotkeys.
          </DialogDescription>
          <div className="h-full min-h-0">
            <SettingsPanel initialTab={settingsTab} />
          </div>
        </DialogContent>
      </Dialog>

      <Toaster richColors theme="dark" />
    </div>
  )
}

function Header({
  version,
  onAsk,
  onSelectSession,
  onOpenSettingsTab,
  onSettings
}: {
  version: string
  onAsk(): void
  onSelectSession(id: string): void
  onOpenSettingsTab(tab: SettingsTabId): void
  onSettings(): void
}) {
  return (
    <header className="flex items-center gap-4">
      <div className="shrink-0">
        <div className="text-xl font-semibold tracking-tight">Zanban</div>
        <div className="font-mono text-[10px] text-muted-foreground">v{version || '…'}</div>
      </div>
      <SearchPill
        onAsk={onAsk}
        onSelectSession={onSelectSession}
        onOpenSettingsTab={onOpenSettingsTab}
      />
      <SessionStartButton />
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full text-muted-foreground hover:text-foreground"
        onClick={onSettings}
        aria-label="Settings"
      >
        <SettingsIcon className="size-4" />
      </Button>
    </header>
  )
}

type SearchHit =
  | { kind: 'session'; id: string; title: string; subtitle: string }
  | { kind: 'settings'; tab: SettingsTabId; label: string; subtitle: string }
  | { kind: 'rag'; sessionId: string; snippet: string; subtitle: string }

function SearchPill({
  onAsk,
  onSelectSession,
  onOpenSettingsTab
}: {
  onAsk(): void
  onSelectSession(id: string): void
  onOpenSettingsTab(tab: SettingsTabId): void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [ragHits, setRagHits] = useState<SearchHit[]>([])

  const { data } = useQuery({
    queryKey: ['sessions-local'],
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  // Semantic search across all past transcripts via sqlite-vec. Debounced
  // 250 ms so we don't hammer the embedder on every keystroke. Falls silent
  // if RAG is unavailable (returns []).
  useEffect(() => {
    const q = text.trim()
    if (q.length < 3) {
      setRagHits([])
      return
    }
    const timer = setTimeout(() => {
      void window.zanban.rag.search(q, 3).then((hits) => {
        setRagHits(
          hits.map((h) => ({
            kind: 'rag' as const,
            sessionId: h.sessionId,
            snippet: h.text.slice(0, 140) + (h.text.length > 140 ? '…' : ''),
            subtitle: `${h.speaker ?? '?'} · ${new Date(h.ts).toLocaleDateString()}`
          }))
        )
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [text])

  const sessionHits = useMemo<SearchHit[]>(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return (data ?? [])
      .filter((s) => (s.title ?? '').toLowerCase().includes(q))
      .slice(0, 5)
      .map((s) => ({
        kind: 'session' as const,
        id: s.id,
        title: s.title || new Date(s.startedAt).toLocaleString(),
        subtitle: new Date(s.startedAt).toLocaleString()
      }))
  }, [data, text])

  const settingsHits = useMemo<SearchHit[]>(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return SETTINGS_TABS.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    )
      .slice(0, 4)
      .map((t) => ({
        kind: 'settings' as const,
        tab: t.id,
        label: t.label,
        subtitle: 'Settings'
      }))
  }, [text])

  const matches = useMemo(
    () => [...settingsHits, ...sessionHits, ...ragHits],
    [settingsHits, sessionHits, ragHits]
  )
  const totalRows = matches.length + 1 // +1 for the trailing "Ask Zanban" row

  function commit(idx: number): void {
    if (idx < matches.length) {
      const hit = matches[idx]
      if (!hit) return
      setOpen(false)
      setText('')
      if (hit.kind === 'session') onSelectSession(hit.id)
      else if (hit.kind === 'rag') onSelectSession(hit.sessionId)
      else onOpenSettingsTab(hit.tab)
    } else {
      setOpen(false)
      setText('')
      onAsk()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, totalRows - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(highlight)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative flex-1">
      <div
        className={cn(
          'group flex items-center gap-2.5 rounded-full border bg-white/[0.03] px-4 py-2.5',
          'transition-colors',
          open
            ? 'border-white/30 bg-white/[0.06]'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.06]'
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setHighlight(0)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Search or ask anything…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {!text && (
          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            ⏎
          </kbd>
        )}
      </div>

      {open && (
        <div
          className={cn(
            'absolute left-0 right-0 top-[calc(100%+6px)] z-50',
            'overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e10]',
            'shadow-2xl backdrop-blur-xl'
          )}
        >
          {settingsHits.length > 0 && (
            <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Settings
            </div>
          )}
          {settingsHits.map((hit, i) => {
            const idx = i
            return (
              <button
                key={`s-${hit.kind === 'settings' ? hit.tab : ''}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(idx)}
                onMouseEnter={() => setHighlight(idx)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  highlight === idx ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                )}
              >
                <SettingsIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {hit.kind === 'settings' ? hit.label : ''}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {hit.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
          {sessionHits.length > 0 && (
            <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Sessions
            </div>
          )}
          {sessionHits.map((hit, i) => {
            const idx = settingsHits.length + i
            return (
              <button
                key={`session-${hit.kind === 'session' ? hit.id : ''}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(idx)}
                onMouseEnter={() => setHighlight(idx)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  highlight === idx ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                )}
              >
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {hit.kind === 'session' ? hit.title : ''}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {hit.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
          {ragHits.length > 0 && (
            <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              From past transcripts
            </div>
          )}
          {ragHits.map((hit, i) => {
            const idx = settingsHits.length + sessionHits.length + i
            return (
              <button
                key={`rag-${i}-${hit.kind === 'rag' ? hit.sessionId : ''}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(idx)}
                onMouseEnter={() => setHighlight(idx)}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-2 text-left transition-colors',
                  highlight === idx ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                )}
              >
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald-400/70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-muted-foreground">
                    {hit.kind === 'rag' ? hit.snippet : ''}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {hit.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
          {text && matches.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              Nothing matches — press{' '}
              <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">↵</kbd> to ask Zanban instead.
            </div>
          )}
          <div className="border-t border-white/[0.05]" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(matches.length)}
            onMouseEnter={() => setHighlight(matches.length)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
              highlight === matches.length ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
            )}
          >
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            <div className="flex-1 truncate text-sm">
              {text ? (
                <>
                  Ask Zanban: <span className="text-muted-foreground">{text}</span>
                </>
              ) : (
                'Ask Zanban anything…'
              )}
            </div>
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ⏎
            </kbd>
          </button>
        </div>
      )}
    </div>
  )
}

function SessionStartButton() {
  const session = useTranscript((s) => s.session)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = wireCaptureAutostop()
    return () => off()
  }, [])

  const running = session.kind === 'running'

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

  return (
    <Button
      onClick={running ? handleStop : handleStart}
      disabled={busy}
      size="default"
      variant={running ? 'destructive' : 'default'}
      className={cn(
        'shrink-0 gap-2 rounded-full px-4',
        !running && 'bg-foreground text-background hover:bg-foreground/90'
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : running ? (
        <Square className="size-3.5 fill-current" />
      ) : (
        <Mic className="size-4" />
      )}
      {running ? 'Stop session' : 'Start session'}
    </Button>
  )
}

function MeetingsList({ onSelect }: { onSelect(id: string): void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions-local'],
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  const groups = useMemo(() => groupByDay(data ?? []), [data])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'failed to load'}
      </p>
    )
  }
  if (!data || data.length === 0) {
    return <EmptyMeetings />
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-2">
          <h2 className="px-1 text-[13px] font-medium text-muted-foreground">{g.label}</h2>
          <ul className="flex flex-col">
            {g.items.map((s) => (
              <MeetingRow key={s.id} session={s} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function MeetingRow({
  session,
  onSelect
}: {
  session: SessionListItem
  onSelect(id: string): void
}) {
  const liveSession = useTranscript((s) => s.session)
  const isRunningElsewhere = liveSession.kind === 'running'
  const date = new Date(session.startedAt)
  const dur = formatDuration(session.durationMs)
  const time = formatTime(date)

  async function resume(): Promise<void> {
    if (isRunningElsewhere) {
      toast.error('A session is already running. Stop it first.')
      return
    }
    try {
      const settings = await window.zanban.settings.get()
      await window.zanban.session.start({ resumeId: session.id })
      await startCapturesFromSettings(settings)
    } catch (err) {
      toast.error('Could not resume session', {
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-3 rounded-md border-b border-white/[0.04]',
          'px-3 py-3 transition-colors hover:bg-white/[0.03]'
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(session.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-sm text-foreground">
            {session.title || formatFallbackTitle(date)}
          </div>
          {!session.endedAt && (
            <Badge variant="destructive" className="mt-1 font-mono text-[9px]">
              REC
            </Badge>
          )}
        </button>
        {dur && (
          <span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">
            {dur}
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums w-[72px] text-right">
          {time}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            void resume()
          }}
          title="Resume — append new audio to this session"
        >
          <Play className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

function EmptyMeetings() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" />
      </div>
      <div className="max-w-sm">
        <div className="text-sm font-medium">No meetings yet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Hit <span className="font-medium text-foreground">Start session</span> above. Sessions
          are saved locally as Markdown when you stop.
        </p>
      </div>
    </div>
  )
}

function groupByDay(
  items: SessionListItem[]
): Array<{ label: string; items: SessionListItem[] }> {
  const sorted = [...items].sort((a, b) => b.startedAt - a.startedAt)
  const out = new Map<string, SessionListItem[]>()
  const today = startOfDay(new Date())
  const yesterday = startOfDay(new Date(today - 86_400_000))
  const sevenDaysAgo = startOfDay(new Date(today - 7 * 86_400_000))

  for (const s of sorted) {
    const day = startOfDay(new Date(s.startedAt))
    let label: string
    if (day === today) label = 'Today'
    else if (day === yesterday) label = 'Yesterday'
    else if (day > sevenDaysAgo) label = 'Earlier this week'
    else label = formatGroupLabel(new Date(s.startedAt))
    if (!out.has(label)) out.set(label, [])
    out.get(label)!.push(s)
  }
  return Array.from(out.entries()).map(([label, items]) => ({ label, items }))
}

function startOfDay(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

function formatGroupLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatFallbackTitle(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function formatDuration(ms?: number | null): string | null {
  if (!ms || ms < 1000) return null
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `00:${String(s).padStart(2, '0')}`
  if (m < 60) return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
