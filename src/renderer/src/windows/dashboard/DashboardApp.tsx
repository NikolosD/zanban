import { useEffect, useMemo, useState } from 'react'
import {
  Settings as SettingsIcon,
  Sparkles,
  Search,
  Mic,
  Square,
  Loader2,
  Play,
  MoreHorizontal,
  Download,
  FolderOpen,
  Trash2
} from 'lucide-react'
import { SessionDetail } from '@renderer/features/sessions/SessionDetail'
import { Wordmark } from '@renderer/components/brand'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import {
  SettingsPanel,
  SETTINGS_TABS,
  type SettingsTabId
} from '@renderer/features/settings/SettingsPanel'
import { AskPanel } from '@renderer/features/ai/AskPanel'
import { OnboardingWizard } from '@renderer/features/onboarding/OnboardingWizard'
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { wireAiIpc } from '@renderer/features/ai/store'
import { useSettingsStore, wireSettingsIpc } from '@renderer/features/settings/store'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
import {
  startCapturesFromSettings,
  stopCaptures,
  wireCaptureAutostop
} from '@renderer/audio/captureController'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Toaster } from '@renderer/components/ui/sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation, Trans } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  formatDuration,
  formatFallbackTitle,
  formatTime,
  groupByDay
} from '@renderer/lib/dateFormat'

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
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const queryClient = useQueryClient()

  // Open the wizard when settings load and `onboardingCompleted` is still
  // false. We don't reset on subsequent loads — the user can dismiss it and
  // we won't re-pop until they manually re-run from Settings.
  useEffect(() => {
    if (settings && !settings.onboardingCompleted) {
      setOnboardingOpen(true)
    }
  }, [settings?.onboardingCompleted])

  useEffect(() => {
    void window.zanban.getVersion().then(setVersion)
    void useSettingsStore.getState().load()
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    const offSettings = wireSettingsIpc()
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
      offSettings()
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
          <MeetingsList
            onSelect={setSelected}
            onOpenSettings={() => {
              setSettingsTab('general')
              setSettingsOpen(true)
            }}
          />
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
            <SettingsPanel
              initialTab={settingsTab}
              onReRunOnboarding={() => {
                setSettingsOpen(false)
                setOnboardingOpen(true)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {settings && (
        <OnboardingWizard
          open={onboardingOpen}
          settings={settings}
          onClose={() => setOnboardingOpen(false)}
        />
      )}

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
  const { t } = useTranslation()
  return (
    <header className="flex items-center gap-5">
      {/* Brand lockup: phase-dot mark + lowercase wordmark + faint mono version. */}
      <Wordmark
        size={20}
        className="shrink-0 text-foreground"
        suffix={
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {version ? `v${version}` : '·'}
          </span>
        }
      />
      <SessionStartButton />
      <SearchPill
        onAsk={onAsk}
        onSelectSession={onSelectSession}
        onOpenSettingsTab={onOpenSettingsTab}
      />
      <button
        onClick={onSettings}
        aria-label={t('settings.title')}
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('dashboard.settings')}
      </button>
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
  const { t } = useTranslation()
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
      (tab) =>
        tab.label.toLowerCase().includes(q) || tab.keywords.some((k) => k.toLowerCase().includes(q))
    )
      .slice(0, 4)
      .map((tab) => ({
        kind: 'settings' as const,
        tab: tab.id,
        label: tab.label,
        subtitle: t('dashboard.search.section_settings')
      }))
  }, [text, t])

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
          placeholder={t('dashboard.search.placeholder')}
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
              {t('dashboard.search.section_settings')}
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
                  <div className="truncate text-sm">{hit.kind === 'settings' ? hit.label : ''}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{hit.subtitle}</div>
                </div>
              </button>
            )
          })}
          {sessionHits.length > 0 && (
            <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('dashboard.search.section_sessions')}
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
                  <div className="truncate text-sm">{hit.kind === 'session' ? hit.title : ''}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{hit.subtitle}</div>
                </div>
              </button>
            )
          })}
          {ragHits.length > 0 && (
            <div className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('dashboard.search.section_past_transcripts')}
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
                {/* RAG-hit row: leading vertical accent line stands in for the
                    icon. Keeps the result list quiet so the bottom Ask CTA is
                    the only sparkle on the panel. */}
                <span className="mt-1 h-3 w-px shrink-0 bg-accent/60" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-muted-foreground">
                    {hit.kind === 'rag' ? hit.snippet : ''}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{hit.subtitle}</div>
                </div>
              </button>
            )
          })}
          {text && matches.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              {t('dashboard.search.no_match_before')}{' '}
              <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">↵</kbd>{' '}
              {t('dashboard.search.no_match_after')}
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
                  {t('dashboard.search.ask_with_text')}{' '}
                  <span className="text-muted-foreground">{text}</span>
                </>
              ) : (
                t('dashboard.search.ask_anything')
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
  const { t } = useTranslation()
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
      toast.error(t('dashboard.toasts.could_not_start'), {
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
        'shrink-0 gap-2 rounded-full px-4 text-[12px] font-medium',
        // Idle: coral (signal) — this is the one primary action of the dashboard.
        // Soft halo signals "press me" without competing with the recording chip
        // since the recording chip lives in the overlay, not here.
        !running && [
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'shadow-[0_0_0_4px_oklch(0.72_0.18_25/0.12)]'
        ]
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : running ? (
        <Square className="size-3.5 fill-current" />
      ) : (
        <Mic className="size-4" />
      )}
      {running ? t('dashboard.stop_session') : t('dashboard.start_session')}
    </Button>
  )
}

function MeetingsList({
  onSelect,
  onOpenSettings
}: {
  onSelect(id: string): void
  onOpenSettings(): void
}) {
  const { t } = useTranslation()
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions-local'],
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  const groups = useMemo(() => groupByDay(data ?? []), [data])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('dashboard.loading')}</p>
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('dashboard.load_failed')}
      </p>
    )
  }
  if (!data || data.length === 0) {
    return <EmptyMeetings onOpenSettings={onOpenSettings} />
  }

  return (
    <div className="flex flex-col gap-12">
      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {g.label}
          </h2>
          <ul className="flex flex-col">
            {g.items.map((s, i) => (
              <MeetingRow
                key={s.id}
                session={s}
                onSelect={onSelect}
                isLast={i === g.items.length - 1}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function MeetingRow({
  session,
  onSelect,
  isLast
}: {
  session: SessionListItem
  onSelect(id: string): void
  isLast: boolean
}) {
  const { t } = useTranslation()
  const liveSession = useTranscript((s) => s.session)
  const queryClient = useQueryClient()
  const isRunningElsewhere = liveSession.kind === 'running'
  const date = new Date(session.startedAt)
  const dur = formatDuration(session.durationMs)
  const time = formatTime(date)
  const isLive = !session.endedAt
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function resume(): Promise<void> {
    if (isRunningElsewhere) {
      toast.error(t('dashboard.session_running_elsewhere'))
      return
    }
    try {
      const settings = await window.zanban.settings.get()
      await window.zanban.session.start({ resumeId: session.id })
      await startCapturesFromSettings(settings)
    } catch (err) {
      toast.error(t('dashboard.could_not_resume'), {
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function exportMd(): Promise<void> {
    try {
      const path = await window.zanban.sessions.exportMarkdown(session.id)
      if (path) toast.success(t('dashboard.toasts.exported'), { description: path })
    } catch (err) {
      toast.error(t('dashboard.toasts.export_failed'), {
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function reveal(): Promise<void> {
    try {
      await window.zanban.sessions.revealFile(session.id)
    } catch {
      /* no-op — best effort */
    }
  }

  async function doDelete(): Promise<void> {
    if (isLive) {
      toast.error(t('dashboard.toasts.stop_before_delete'))
      setConfirmDelete(false)
      return
    }
    setDeleting(true)
    try {
      const result = await window.zanban.sessions.delete(session.id)
      if (result.ok) {
        toast.success(t('dashboard.toasts.session_deleted'))
        await queryClient.invalidateQueries({ queryKey: ['sessions-local'] })
      } else {
        toast.error(t('dashboard.toasts.could_not_delete'))
      }
    } catch (err) {
      toast.error(t('dashboard.toasts.delete_failed'), {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <li className={cn(!isLast && 'border-b border-white/[0.045]')}>
      <div
        className={cn(
          'group flex items-center gap-4 px-1 py-3 transition-colors',
          'hover:bg-white/[0.025]'
        )}
      >
        {/* Leading slot is reserved for the live signal. Kept fixed-width so
            titles align across rows whether or not a row is recording. */}
        <span className="flex w-2.5 shrink-0 items-center justify-center">
          {isLive && (
            <span className="size-1.5 rounded-full bg-primary motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]" />
          )}
        </span>
        <button
          type="button"
          onClick={() => onSelect(session.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-[13.5px] font-medium text-foreground">
            {session.title || formatFallbackTitle(date)}
          </div>
        </button>
        {dur && (
          <span className="w-12 text-right font-mono text-[11px] tabular-nums text-muted-foreground/80">
            {dur}
          </span>
        )}
        <span className="w-[68px] text-right font-mono text-[11px] tabular-nums text-muted-foreground/55">
          {time}
        </span>
        {/* Per UX review: actions are now always visible (muted) and brighten
            on row hover. Hover-only icons trigger phantom interactions with
            trackpad scroll on long lists. */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground/55 group-hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              void resume()
            }}
            title={t('dashboard.session_actions.resume_tooltip')}
          >
            <Play className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground/55 group-hover:text-foreground transition-colors data-[state=open]:text-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label={t('dashboard.session_actions.menu_aria')}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[180px]"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem
                onSelect={() => {
                  void exportMd()
                }}
              >
                <Download className="size-3.5" />
                <span>{t('dashboard.session_actions.export_markdown')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void reveal()
                }}
              >
                <FolderOpen className="size-3.5" />
                <span>{t('dashboard.session_actions.reveal_in_folder')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={isLive}
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" />
                <span>{t('dashboard.session_actions.delete')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-base font-semibold tracking-tight">
            {t('dashboard.session_actions.confirm_title')}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            <Trans
              i18nKey="dashboard.session_actions.confirm_body"
              values={{ title: session.title || formatFallbackTitle(date) }}
              components={{ 0: <span className="text-foreground" /> }}
            />
          </DialogDescription>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-[12px]"
            >
              {t('dashboard.session_actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doDelete()}
              disabled={deleting}
              className="text-[12px]"
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('dashboard.session_actions.confirm_delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

function EmptyMeetings({ onOpenSettings }: { onOpenSettings: () => void }) {
  // Empty state: typographic, not iconographic. A single faint dot anchors
  // the column and echoes the recording-dot motif used elsewhere — quieter
  // than a centered illustration and consistent with the tools-not-bragging
  // tone in PRODUCT.md. Adds an inline CTA when API keys are missing so a
  // brand-new user doesn't only learn about the requirement at session start.
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const missingProviders = settings ? missingProviderNames(settings) : []
  const apiKeysMissing = missingProviders.length > 0
  return (
    <div className="flex flex-col items-start gap-3 border-t border-white/[0.04] py-14">
      <span className="size-1 rounded-full bg-muted-foreground/40" />
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('dashboard.no_sessions_label')}
      </div>
      <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
        <Trans
          i18nKey="dashboard.no_sessions_body"
          components={[<span key="0" className="text-foreground" />]}
        />
      </p>
      {apiKeysMissing && (
        <div className="mt-2 flex max-w-md flex-col items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
            {t('dashboard.setup_first')}
          </div>
          <p className="text-[12px] leading-relaxed text-amber-100/90">
            {t('dashboard.setup_first_body', { providers: missingProviders.join(', ') })}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[12px] text-amber-200 hover:bg-amber-500/15 hover:text-amber-100"
            onClick={onOpenSettings}
          >
            {t('common.open_settings')}
          </Button>
        </div>
      )}
    </div>
  )
}
