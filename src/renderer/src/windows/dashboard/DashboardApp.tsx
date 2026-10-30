import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Settings as SettingsIcon,
  Sparkles,
  Search,
  Mic,
  Square,
  Loader2,
  MoreHorizontal,
  Download,
  FolderOpen,
  Trash2
} from 'lucide-react'
import type { CaptureNoticeKind } from '@shared/types'
import type { HotkeyConflict } from '@shared/api'
import { SessionDetail } from '@renderer/features/sessions/SessionDetail'
import { GlobalActionItems } from '@renderer/features/sessions/GlobalActionItems'
import { RecapOffer } from '@renderer/features/sessions/RecapOffer'
import { useRecapAfterCall } from '@renderer/features/sessions/useRecapAfterCall'
import { useOpenActionItemCount } from '@renderer/features/sessions/actionItemState'
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
  SETTINGS_TAB_IDS,
  type SettingsTabId
} from '@renderer/features/settings/SettingsPanel'
import { AskPanel } from '@renderer/features/ai/AskPanel'
import { JobsBadge } from '@renderer/features/jobs/JobsBadge'
import { wireJobsIpc } from '@renderer/features/jobs/jobsStore'
import { OnboardingWizard } from '@renderer/features/onboarding/OnboardingWizard'
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { wireAiIpc } from '@renderer/features/ai/store'
import { useSettingsStore, wireSettingsIpc } from '@renderer/features/settings/store'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
import { stopCaptures, wireCaptureAutostop } from '@renderer/audio/captureController'
import {
  resumeSession,
  startSessionWithCapture,
  toastSessionError
} from '@renderer/features/transcript/sessionStart'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { acceleratorTokens } from '@renderer/features/settings/KeyRecorder'
import { showHotkeyConflicts } from '@renderer/features/settings/HotkeyConflictNotice'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Toaster } from '@renderer/components/ui/sonner'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from 'i18next'
import { useTranslation, Trans } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { errorMessage } from '@renderer/lib/errors'
import { queryKeys } from '@renderer/lib/queryKeys'
import {
  formatDuration,
  formatFallbackTitle,
  formatRowStamp,
  groupByDay
} from '@renderer/lib/dateFormat'

type SessionListItem = {
  id: string
  title?: string | null
  startedAt: number
  endedAt?: number | null
  durationMs?: number | null
}

const CAPTURE_NOTICE_TOASTS: Record<CaptureNoticeKind, { key: string; error: boolean }> = {
  'mic-lost': { key: 'capture.mic_lost', error: true },
  'mic-healed': { key: 'capture.mic_healed', error: false },
  'mic-silent': { key: 'capture.mic_silent', error: false },
  'system-unavailable': { key: 'capture.system_unavailable', error: true }
}

export function DashboardApp() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [askPrompt, setAskPrompt] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general')
  const [askKey, setAskKey] = useState(0)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [searchFocusKey, setSearchFocusKey] = useState(0)
  const settings = useSettingsStore((s) => s.settings)
  const queryClient = useQueryClient()

  function openSettings(tab: SettingsTabId = 'general'): void {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  // Set only while the open session was reached from the end of its own call.
  const [afterCall, setAfterCall] = useState<string | null>(null)
  if (afterCall !== null && afterCall !== selected) setAfterCall(null)
  const recapAfterCall = useRecapAfterCall((sessionId) => {
    setSelected(sessionId)
    setAfterCall(sessionId)
  }, selected)

  // Lives at the root, not in the header button, so capture auto-stop and the
  // tray Start/Stop listeners stay mounted while a past meeting is open. Start
  // failures that need credentials are STT keys, which sit on the Audio tab.
  const sessionControl = useSessionControl(() => openSettings('keys'), recapAfterCall.claimNextStop)

  // Open the wizard when settings load and `onboardingCompleted` is still
  // false. We don't reset on subsequent loads — the user can dismiss it and
  // we won't re-pop until they manually re-run from Settings.
  const onboardingPending = settings ? !settings.onboardingCompleted : undefined
  const [seenOnboardingPending, setSeenOnboardingPending] = useState<boolean | undefined>()
  if (onboardingPending !== seenOnboardingPending) {
    setSeenOnboardingPending(onboardingPending)
    if (onboardingPending) setOnboardingOpen(true)
  }

  useEffect(() => {
    void window.zanban.getVersion().then(setVersion)
    void useSettingsStore.getState().load()
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    const offSettings = wireSettingsIpc()
    const offJobs = wireJobsIpc()
    // The session list is loaded via React Query and the dashboard window
    // never loses focus when a session ends in the overlay — so without an
    // explicit invalidation the user would only see the new session after a
    // manual refresh / page reload. Refetching the moment the session goes
    // back to idle closes that gap.
    const offSession = window.zanban.session.onState((state) => {
      if (state.kind === 'idle') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // An open live session stops polling once idle; fetch its final tail.
        void queryClient.invalidateQueries({ queryKey: ['session-detail-local'] })
      }
    })
    // Any recap write (manual, or the auto-recap after a session stops) can
    // add or drop "owner: you" action items.
    const offRecap = window.zanban.recap.onUpdated((sessionId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.globalActionItems })
      void queryClient.invalidateQueries({ queryKey: queryKeys.recap(sessionId) })
    })
    // Tray "Settings" opens the dashboard then asks us to surface the dialog.
    const offOpenSettings = window.zanban.dashboard.onOpenSettings(() => {
      setSettingsTab('general')
      setSettingsOpen(true)
    })
    // Update lifecycle: a downloaded update offers a persistent "Restart to
    // update" toast (quitAndInstall); errors surface as a transient toast.
    // Strings resolve through the i18n instance at call time so a language
    // switch doesn't tear down and re-wire every subscription here.
    const offUpdate = window.zanban.updater.onDownloaded((info) => {
      toast(i18n.t('updates.available_title'), {
        description: i18n.t('updates.available_body', { version: info.version }),
        duration: Infinity,
        action: {
          label: i18n.t('updates.restart'),
          onClick: () => void window.zanban.updater.quitAndInstall()
        }
      })
    })
    const offUpdateErr = window.zanban.updater.onError((message) => {
      toast.error(i18n.t('updates.error'), { description: message })
    })
    // Covers the startup registration too, which runs before this window loads.
    const toastHotkeyConflicts = (failed: HotkeyConflict[]) =>
      showHotkeyConflicts(failed, () => {
        setSettingsTab('hotkeys')
        setSettingsOpen(true)
      })
    void window.zanban.settings.hotkeyConflicts().then(toastHotkeyConflicts)
    const offHotkeyConflict = window.zanban.settings.onHotkeyConflict(toastHotkeyConflicts)
    return () => {
      offTr()
      offAi()
      offSession()
      offRecap()
      offSettings()
      offJobs()
      offOpenSettings()
      offUpdate()
      offUpdateErr()
      offHotkeyConflict()
    }
  }, [queryClient])

  // Ctrl/Cmd+K and "/" jump to the search from anywhere; Esc backs out of a
  // session. Keys typed into a field or an open dialog/menu stay theirs.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('[role="dialog"], [role="menu"]')) return
      const editable =
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const modK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !editable && !e.ctrlKey && !e.metaKey && !e.altKey
      if (modK || slash) {
        e.preventDefault()
        setSelected(null)
        setSearchFocusKey((k) => k + 1)
      } else if (e.key === 'Escape' && !editable) {
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {selected ? (
        <main className="mx-auto max-w-4xl px-10 pt-8 pb-8">
          <SessionDetail
            sessionId={selected}
            afterCall={selected === afterCall}
            onBack={() => setSelected(null)}
            onOpenSettings={() => openSettings('keys')}
          />
        </main>
      ) : (
        <main className="mx-auto max-w-5xl px-10 pt-10 pb-16">
          <Header
            version={version}
            session={sessionControl}
            searchFocusKey={searchFocusKey}
            onAsk={(question) => {
              setAskPrompt(question || null)
              setAskKey((k) => k + 1)
              setAskOpen(true)
            }}
            onSelectSession={setSelected}
            onOpenSettingsTab={openSettings}
            onSettings={() => openSettings()}
          />
          {recapAfterCall.offered && <RecapOffer onOpen={recapAfterCall.openOffered} />}
          <div className="mt-10">
            <GlobalActionItems onSelect={setSelected} />
          </div>
          <div className="mt-10">
            <MeetingsList onSelect={setSelected} onOpenSettings={(tab) => openSettings(tab)} />
          </div>
        </main>
      )}

      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="sr-only">{t('dashboard.ask_dialog.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('dashboard.ask_dialog.description')}
          </DialogDescription>
          <div className="p-4 h-[520px]">
            <AskPanel
              autoFocusKey={askKey}
              initialPrompt={askPrompt ?? undefined}
              className="h-full"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden gap-0 h-[640px]">
          <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('settings.dialog_description')}
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
  session,
  searchFocusKey,
  onAsk,
  onSelectSession,
  onOpenSettingsTab,
  onSettings
}: {
  version: string
  session: SessionControl
  searchFocusKey: number
  onAsk(question?: string): void
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
          <span className="font-mono text-meta tabular-nums text-muted-foreground/70">
            {version ? `v${version}` : '·'}
          </span>
        }
      />
      <SessionStartButton session={session} />
      <SearchPill
        focusKey={searchFocusKey}
        onAsk={onAsk}
        onSelectSession={onSelectSession}
        onOpenSettingsTab={onOpenSettingsTab}
      />
      {/* No gap here: the always-mounted (often empty) live region must not
          add spacing; the badge carries its own margin when visible. */}
      <div className="flex shrink-0 items-center">
        <JobsBadge />
        <Button
          variant="ghost"
          size="sm"
          onClick={onSettings}
          aria-label={t('settings.title')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <SettingsIcon className="size-4" aria-hidden />
          {t('dashboard.settings')}
        </Button>
      </div>
    </header>
  )
}

type SearchHit =
  | { kind: 'session'; id: string; title: string; subtitle: string }
  | { kind: 'settings'; tab: SettingsTabId; label: string; subtitle: string }
  | { kind: 'rag'; sessionId: string; snippet: string; subtitle: string }

const RAG_MIN_QUERY = 3

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function SearchPill({
  focusKey,
  onAsk,
  onSelectSession,
  onOpenSettingsTab
}: {
  focusKey: number
  onAsk(question?: string): void
  onSelectSession(id: string): void
  onOpenSettingsTab(tab: SettingsTabId): void
}) {
  const { t, i18n } = useTranslation()
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const query = text.trim()
  const ragQuery = useDebouncedValue(query, 250)

  useEffect(() => {
    if (focusKey > 0) inputRef.current?.focus()
  }, [focusKey])

  const { data } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })

  // Semantic search across all past transcripts via sqlite-vec, debounced so
  // we don't hammer the embedder on every keystroke. Results are keyed by the
  // query, so a slow response for an older query can't replace a newer one.
  const ragActive = query.length >= RAG_MIN_QUERY && ragQuery.length >= RAG_MIN_QUERY
  const { data: ragResults } = useQuery({
    queryKey: queryKeys.ragSearch(ragQuery),
    queryFn: () => window.zanban.rag.search(ragQuery, 3),
    enabled: ragActive,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData
  })

  const ragHits = useMemo<SearchHit[]>(() => {
    if (!ragActive || !ragResults) return []
    return (
      ragResults
        // This list navigates to a session on click, so only session/recap
        // hits (which carry a session id) are actionable here; doc fragments
        // are surfaced under answers via the Sources affordance instead.
        .filter((h) => h.sourceKind !== 'doc')
        .map((h) => ({
          kind: 'rag' as const,
          sessionId: h.sourceId,
          snippet: h.text.slice(0, 140) + (h.text.length > 140 ? '…' : ''),
          subtitle: `${h.speaker ?? '?'} · ${new Date(h.ts).toLocaleDateString(i18n.language)}`
        }))
    )
  }, [ragActive, ragResults, i18n.language])

  const sessionHits = useMemo<SearchHit[]>(() => {
    const q = query.toLowerCase()
    if (!q) return []
    return (data ?? [])
      .filter((s) => (s.title ?? '').toLowerCase().includes(q))
      .slice(0, 5)
      .map((s) => ({
        kind: 'session' as const,
        id: s.id,
        title: s.title || formatFallbackTitle(new Date(s.startedAt), i18n.language),
        subtitle: formatFallbackTitle(new Date(s.startedAt), i18n.language)
      }))
  }, [data, query, i18n.language])

  // Labels and keywords come from the active locale so a Russian query finds
  // Russian settings; brand names stay in both keyword lists.
  const settingsHits = useMemo<SearchHit[]>(() => {
    const q = query.toLowerCase()
    if (!q) return []
    return SETTINGS_TAB_IDS.map((id) => ({
      id,
      label: t(`settings.tabs.${id}`),
      keywords: t(`settings.search_keywords.${id}`).split(',')
    }))
      .filter(
        ({ label, keywords }) =>
          label.toLowerCase().includes(q) ||
          keywords.some((k) => k.trim().toLowerCase().includes(q))
      )
      .slice(0, 4)
      .map(({ id, label }) => ({
        kind: 'settings' as const,
        tab: id,
        label,
        subtitle: t('dashboard.search.section_settings')
      }))
  }, [query, t])

  const matches = useMemo(
    () => [...settingsHits, ...sessionHits, ...ragHits],
    [settingsHits, sessionHits, ragHits]
  )
  // The trailing "Ask Zanban" row sits at index matches.length. Until a row is
  // picked, Enter takes the first instant match or asks: transcript hits land
  // a moment later and would change what Enter does mid-typing. Clamp so a
  // shrinking result list never leaves the highlight on a row that's gone.
  const firstPick = settingsHits.length + sessionHits.length > 0 ? 0 : matches.length
  const active = Math.min(highlight ?? firstPick, matches.length)
  const optionId = (idx: number): string => `${listboxId}-option-${idx}`

  function commit(idx: number): void {
    setOpen(false)
    setText('')
    const hit = matches[idx]
    if (!hit) onAsk(query)
    else if (hit.kind === 'session') onSelectSession(hit.id)
    else if (hit.kind === 'rag') onSelectSession(hit.sessionId)
    else onOpenSettingsTab(hit.tab)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight(Math.min(active + 1, matches.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(Math.max(active - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(active)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function option(idx: number, children: React.ReactNode, className?: string): React.ReactNode {
    return (
      <SearchOption
        key={optionId(idx)}
        id={optionId(idx)}
        selected={active === idx}
        onSelect={() => commit(idx)}
        onHover={() => setHighlight(idx)}
        className={className}
      >
        {children}
      </SearchOption>
    )
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
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t('dashboard.search.aria_label')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? optionId(active) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setHighlight(null)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={t('dashboard.search.placeholder')}
          className="flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground outline-none"
        />
        {!text && (
          <kbd
            aria-hidden
            className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-meta text-muted-foreground sm:inline"
          >
            {open ? '⏎' : '/'}
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
          {text && matches.length === 0 && (
            <div className="px-3 py-2 text-small text-muted-foreground">
              {t('dashboard.search.no_match_before')}{' '}
              <kbd className="rounded bg-white/10 px-1 font-mono text-meta">↵</kbd>{' '}
              {t('dashboard.search.no_match_after')}
            </div>
          )}
          <div id={listboxId} role="listbox" aria-label={t('dashboard.search.aria_label')}>
            {settingsHits.length > 0 && (
              <SearchGroup label={t('dashboard.search.section_settings')}>
                {settingsHits.map(
                  (hit, i) =>
                    hit.kind === 'settings' &&
                    option(
                      i,
                      <>
                        <SettingsIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body">{hit.label}</div>
                          <div className="font-mono text-meta text-muted-foreground">
                            {hit.subtitle}
                          </div>
                        </div>
                      </>
                    )
                )}
              </SearchGroup>
            )}
            {sessionHits.length > 0 && (
              <SearchGroup label={t('dashboard.search.section_sessions')}>
                {sessionHits.map(
                  (hit, i) =>
                    hit.kind === 'session' &&
                    option(
                      settingsHits.length + i,
                      <>
                        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body">{hit.title}</div>
                          <div className="font-mono text-meta text-muted-foreground">
                            {hit.subtitle}
                          </div>
                        </div>
                      </>
                    )
                )}
              </SearchGroup>
            )}
            {ragHits.length > 0 && (
              <SearchGroup label={t('dashboard.search.section_past_transcripts')}>
                {ragHits.map(
                  (hit, i) =>
                    hit.kind === 'rag' &&
                    option(
                      settingsHits.length + sessionHits.length + i,
                      <>
                        {/* RAG-hit row: leading vertical accent line stands in
                            for the icon. Keeps the result list quiet so the
                            bottom Ask CTA is the only sparkle on the panel. */}
                        <span className="mt-1 h-3 w-px shrink-0 bg-border" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-small text-muted-foreground">
                            {hit.snippet}
                          </div>
                          <div className="font-mono text-meta text-muted-foreground">
                            {hit.subtitle}
                          </div>
                        </div>
                      </>,
                      'items-start'
                    )
                )}
              </SearchGroup>
            )}
            {option(
              matches.length,
              <>
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex-1 truncate text-body">
                  {text ? (
                    <>
                      {t('dashboard.search.ask_with_text')}{' '}
                      <span className="text-muted-foreground">{text}</span>
                    </>
                  ) : (
                    t('dashboard.search.ask_anything')
                  )}
                </div>
                <kbd
                  aria-hidden
                  className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-meta text-muted-foreground"
                >
                  ⏎
                </kbd>
              </>,
              cn('py-2.5', matches.length > 0 && 'border-t border-white/[0.05]')
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SearchGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId}>
      <div
        id={labelId}
        role="presentation"
        className="px-3 pt-2 pb-1 font-mono text-meta uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </div>
      {children}
    </div>
  )
}

/**
 * One row of the search listbox. Focus stays in the combobox input (the row
 * is announced via aria-activedescendant), so rows are never tab stops; mouse
 * down is swallowed to keep the input from blurring before the click lands.
 */
function SearchOption({
  id,
  selected,
  onSelect,
  onHover,
  className,
  children
}: {
  id: string
  selected: boolean
  onSelect(): void
  onHover(): void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors',
        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]',
        className
      )}
    >
      {children}
    </div>
  )
}

interface SessionControl {
  running: boolean
  busy: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

function useSessionControl(
  onOpenSettings: () => void,
  claimNextStop: () => () => void
): SessionControl {
  const { t } = useTranslation()
  const running = useTranscript((s) => s.session.kind === 'running')
  const [busy, setBusy] = useState(false)

  // Keep the latest handlers in refs so the tray IPC subscription (mounted
  // once) always calls the current closure without re-subscribing on every
  // state change.
  const startRef = useRef<() => void>(() => {})
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    const off = wireCaptureAutostop()
    // Tray "Start/Stop session" routes here so the renderer's capture pipeline
    // (mic/system audio) runs — the main process can't capture audio itself.
    const offStart = window.zanban.dashboard.onRequestStartSession(() => startRef.current())
    const offStop = window.zanban.dashboard.onRequestStopSession(() => stopRef.current())
    return () => {
      off()
      offStart()
      offStop()
    }
  }, [])

  useEffect(
    () =>
      window.zanban.audio.onNotice(({ kind }) => {
        const { key, error } = CAPTURE_NOTICE_TOASTS[kind]
        if (error) toast.error(i18n.t(key))
        else toast.warning(i18n.t(key))
      }),
    []
  )

  async function start(): Promise<void> {
    setBusy(true)
    try {
      await startSessionWithCapture()
    } catch (err) {
      toastSessionError(t('dashboard.toasts.could_not_start'), err, onOpenSettings)
    } finally {
      setBusy(false)
    }
  }

  async function stop(): Promise<void> {
    setBusy(true)
    const releaseStop = claimNextStop()
    try {
      stopCaptures()
      await window.zanban.session.stop()
    } catch (err) {
      toastSessionError(t('dashboard.toasts.could_not_stop'), err)
    } finally {
      releaseStop()
      setBusy(false)
    }
  }

  // Keep the ref-held tray handlers current (they capture busy/running/handlers)
  // without re-subscribing the IPC listener on every state change. Updating the
  // ref in an effect (not during render) keeps the lint rule happy. A tray
  // request is a no-op if we're mid-transition or already in the target state,
  // mirroring the button's own disabled/guard behavior.
  useEffect(() => {
    startRef.current = () => {
      if (!busy && !running) void start()
    }
    stopRef.current = () => {
      if (!busy && running) void stop()
    }
  })

  return { running, busy, start, stop }
}

function SessionStartButton({ session }: { session: SessionControl }) {
  const { t } = useTranslation()
  const { running, busy } = session

  return (
    <Button
      onClick={() => void (running ? session.stop() : session.start())}
      disabled={busy}
      size="default"
      variant={running ? 'destructive' : 'default'}
      className={cn(
        'shrink-0 gap-2 rounded-full px-4 text-body font-medium',
        !running && 'bg-primary text-primary-foreground hover:bg-primary/90'
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
  onOpenSettings(tab?: SettingsTabId): void
}) {
  const { t, i18n } = useTranslation()
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => window.zanban.sessions.list(),
    refetchOnWindowFocus: true
  })
  const live = useTranscript((s) => (s.session.kind === 'running' ? s.session : null))

  // The record is first written a few seconds into the call; until the list
  // has it, the running session comes from the live state.
  const items = useMemo(() => {
    const list = data ?? []
    if (!live || list.some((s) => s.id === live.sessionId)) return list
    return [
      {
        id: live.sessionId,
        startedAt: live.startedAt,
        endedAt: null,
        title: null,
        durationMs: null
      },
      ...list
    ]
  }, [data, live])

  const groups = useMemo(
    () =>
      groupByDay(
        items,
        {
          today: t('dashboard.groups.today'),
          yesterday: t('dashboard.groups.yesterday'),
          thisWeek: t('dashboard.groups.this_week')
        },
        i18n.language
      ),
    [items, t, i18n.language]
  )

  if (isLoading) {
    return <p className="text-body text-muted-foreground">{t('dashboard.loading')}</p>
  }
  if (error) {
    return (
      <p className="text-body text-destructive">
        {error instanceof Error ? error.message : t('dashboard.load_failed')}
      </p>
    )
  }
  if (items.length === 0) {
    return <EmptyMeetings onOpenSettings={() => onOpenSettings()} />
  }

  return (
    <div className="flex flex-col gap-12">
      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-3">
          <h2 className="font-mono text-meta uppercase tracking-[0.16em] text-muted-foreground">
            {g.label}
          </h2>
          <ul className="flex flex-col">
            {g.items.map((s, i) => (
              <MeetingRow
                key={s.id}
                session={s}
                onSelect={onSelect}
                onOpenSettings={() => onOpenSettings('audio')}
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
  onOpenSettings,
  isLast
}: {
  session: SessionListItem
  onSelect(id: string): void
  onOpenSettings(): void
  isLast: boolean
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const date = new Date(session.startedAt)
  const dur = formatDuration(session.durationMs)
  const stamp = formatRowStamp(date, i18n.language)
  const isLive = !session.endedAt
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Shares the detail view's recap cache; recap.onUpdated invalidates it.
  const { data: recap } = useQuery({
    queryKey: queryKeys.recap(session.id),
    queryFn: () => window.zanban.recap.get(session.id),
    enabled: !isLive,
    staleTime: Infinity
  })
  const openItems = useOpenActionItemCount(session.id, recap?.actionItems ?? [])

  async function exportMd(): Promise<void> {
    try {
      const path = await window.zanban.sessions.exportMarkdown(session.id)
      if (path) toast.success(t('dashboard.toasts.exported'), { description: path })
    } catch (err) {
      toast.error(t('dashboard.toasts.export_failed'), {
        description: errorMessage(err)
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
          queryClient.invalidateQueries({ queryKey: queryKeys.globalActionItems })
        ])
      } else {
        toast.error(t('dashboard.toasts.could_not_delete'))
      }
    } catch (err) {
      toast.error(t('dashboard.toasts.delete_failed'), {
        description: errorMessage(err)
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
            <span className="size-1.5 rounded-full bg-signal motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]" />
          )}
        </span>
        <button
          type="button"
          onClick={() => onSelect(session.id)}
          className="min-w-0 flex-1 text-left"
        >
          {/* The time column already shows when it happened, so an untitled
              session reads "Untitled" instead of repeating the date. */}
          <div
            className={cn(
              'truncate text-body font-medium',
              session.title ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {session.title || t('dashboard.row.untitled')}
          </div>
          {recap && (
            <div className="mt-0.5 flex gap-1.5 text-small text-muted-foreground">
              <span className="min-w-0 truncate">{firstSentence(recap.tldr)}</span>
              {openItems > 0 && (
                <span className="shrink-0">
                  · {t('dashboard.row.open_items', { count: openItems })}
                </span>
              )}
            </div>
          )}
        </button>
        <span className="w-24 text-right font-mono text-small tabular-nums text-muted-foreground">
          {isLive ? <span className="text-signal">{t('dashboard.row.live')}</span> : dur}
        </span>
        <span className="w-24 text-right font-mono text-small tabular-nums text-muted-foreground">
          {stamp}
        </span>
        {/* Per UX review: actions are now always visible (muted) and brighten
            on row hover. Hover-only icons trigger phantom interactions with
            trackpad scroll on long lists. */}
        <div className="flex items-center gap-0.5">
          {!isLive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-small font-normal text-muted-foreground group-hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                void resumeSession(session.id, onOpenSettings)
              }}
              title={t('dashboard.session_actions.resume_tooltip')}
            >
              {t('dashboard.session_actions.resume')}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground group-hover:text-foreground transition-colors data-[state=open]:text-foreground"
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
          <DialogTitle className="text-lead font-semibold tracking-tight">
            {t('dashboard.session_actions.confirm_title')}
          </DialogTitle>
          <DialogDescription className="text-body text-muted-foreground">
            <Trans
              i18nKey="dashboard.session_actions.confirm_body"
              values={{ title: session.title || formatFallbackTitle(date, i18n.language) }}
              components={{ 0: <span className="text-foreground" /> }}
            />
          </DialogDescription>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-small"
            >
              {t('dashboard.session_actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doDelete()}
              disabled={deleting}
              className="text-small"
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

function firstSentence(text: string): string {
  const trimmed = text.trim()
  return /^[\s\S]*?[.!?…](?=\s|$)/.exec(trimmed)?.[0] ?? trimmed
}

// The three shortcuts a first call needs; the same set the onboarding wizard ends with.
const QUICK_HOTKEYS = ['toggleOverlay', 'answerLast', 'toggleSession'] as const

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
      <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
        {t('dashboard.no_sessions_label')}
      </div>
      <p className="max-w-md text-body leading-relaxed text-muted-foreground">
        <Trans
          i18nKey="dashboard.no_sessions_body"
          components={[<span key="0" className="text-foreground" />]}
        />
      </p>
      {settings && (
        <div className="mt-4 flex w-full max-w-md flex-col gap-2">
          <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
            {t('onboarding.done.hotkeys_title')}
          </div>
          <div className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
            {QUICK_HOTKEYS.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-body text-foreground/90">
                  {t(`onboarding.done.hotkeys.${k}`)}
                </span>
                <span className="flex items-center gap-1">
                  {acceleratorTokens(settings.hotkeys[k]).map((part, i) => (
                    <Kbd key={i} size="md">
                      {part}
                    </Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {apiKeysMissing && (
        <div className="mt-2 flex max-w-md flex-col items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
          <div className="font-mono text-meta uppercase tracking-wider text-warn">
            {t('dashboard.setup_first')}
          </div>
          <p className="text-small leading-relaxed text-foreground/85">
            {t('dashboard.setup_first_body', { providers: missingProviders.join(', ') })}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-small text-warn hover:bg-warn/15 hover:text-warn"
            onClick={onOpenSettings}
          >
            {t('common.open_settings')}
          </Button>
        </div>
      )}
    </div>
  )
}
