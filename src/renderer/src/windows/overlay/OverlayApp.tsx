import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  X,
  Send,
  AlertTriangle,
  EyeOff,
  Eye,
  Square,
  Loader2,
  ChevronDown,
  Copy,
  ArrowDownToLine,
  Camera
} from 'lucide-react'
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { wireAiIpc, useAi } from '@renderer/features/ai/store'
import { useAskRequest } from '@renderer/features/ai/useAskRequest'
import { wireJobsIpc } from '@renderer/features/jobs/jobsStore'
import { JobsBadge } from '@renderer/features/jobs/JobsBadge'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { useSettingsStore, wireSettingsIpc } from '@renderer/features/settings/store'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
import {
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_FAST_MODELS,
  PROVIDER_VISION_MODELS,
  type LlmProvider
} from '@shared/types'
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '@shared/prompts'
import { Button } from '@renderer/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import { Toaster } from '@renderer/components/ui/sonner'
import { Kbd } from '@renderer/components/ui/kbd'
import { acceleratorTokens } from '@renderer/features/settings/KeyRecorder'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { useStickToBottom } from '@renderer/lib/useStickToBottom'
import { stopCaptures, wireCaptureAutostop } from '@renderer/audio/captureController'
import { ZanbanMark } from '@renderer/components/brand'
import { AnswerPaneResizer } from './AnswerPaneResizer'
import { DEFAULT_ANSWER_MAX_HEIGHT, clampAnswerHeight, computeHardCap } from './answerPaneResize'
import { RollingTranscript } from './RollingTranscript'

export function OverlayApp() {
  const { t } = useTranslation()
  const [stealth, setStealth] = useState(true)
  const [text, setText] = useState('')
  const { run: runAsk, stop: stopAsk, busy } = useAskRequest()
  const [stoppingSession, setStoppingSession] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  // Tracks the in-flight instant snapshot so a late-arriving OCR result folds
  // into the *current* attachment and not a stale one the user already cleared
  // or replaced (F1).
  const snapshotIdRef = useRef<string | null>(null)
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const runPromptRef = useRef<
    (
      prompt: string,
      label?: string,
      imageDataUrl?: string,
      waitForTranscript?: boolean,
      ocr?: string | null
    ) => Promise<void>
  >(() => Promise.resolve())
  const ignoreMouseRef = useRef<boolean | null>(null)
  const session = useTranscript((s) => s.session)
  const t0 = session.kind === 'running' ? session.startedAt : null
  const elapsed = useElapsed(session.kind === 'running', t0)
  const settings = useSettingsStore((s) => s.settings)
  const refreshSettings = useSettingsStore((s) => s.load)
  const status = useTranscript((s) => s.status)
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)

  const persistedAnswerMax = settings?.overlayAnswerMaxHeight ?? DEFAULT_ANSWER_MAX_HEIGHT
  const [userMaxHeight, setUserMaxHeight] = useState<number>(persistedAnswerMax)
  const [hardCap, setHardCap] = useState<number>(() =>
    typeof window !== 'undefined' ? computeHardCap(window.screen.availHeight) : 720
  )

  // Re-derive hardCap on screen change. Listening to `resize` is enough for
  // monitor swaps under Electron because the overlay window itself resizes
  // when moved between displays.
  useEffect(() => {
    function recompute() {
      setHardCap(computeHardCap(window.screen.availHeight))
    }
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])

  // Adopt the persisted value when settings load / change, clamped to the
  // current hardCap. We don't write the clamp back to settings — returning to a
  // bigger monitor should restore the user's original preference.
  useEffect(() => {
    setUserMaxHeight(clampAnswerHeight(persistedAnswerMax, hardCap))
  }, [persistedAnswerMax, hardCap])

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitAnswerMaxHeight = useCallback((next: number) => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      void window.zanban.settings.set({ overlayAnswerMaxHeight: next })
    }, 300)
  }, [])

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    },
    []
  )

  // Keep the history pane pinned to the latest answer as it streams. The pin
  // releases when the user scrolls up to read older Q&A, so we don't yank
  // them back; a fresh Q&A re-arms it.
  const { rootRef: historyRef } = useStickToBottom<HTMLDivElement>(
    latest?.id,
    latest?.answer.length
  )
  const transcriptionError =
    status.mic?.kind === 'error'
      ? status.mic.message
      : status.system?.kind === 'error'
        ? status.system.message
        : null

  const missingProviders = settings ? missingProviderNames(settings) : []
  const apiKeysMissing = missingProviders.length > 0

  // Auto-grow the OS window to fit the visible panel. Mirrors the approach
  // used in natively-cluely-ai-assistant: useLayoutEffect runs before paint,
  // sends dimensions directly (no rAF throttle) so streaming answers don't
  // get clipped by a frame-late IPC. Main clamps to the work area, so very
  // long answers fall back to internal scrolling rather than running
  // off-screen.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const send = (): void => {
      const rect = el.getBoundingClientRect()
      // 24px = outer p-3 padding above and below the panel (12px each), plus
      // an extra 4px so the rounded bottom border isn't shaved when the OS
      // rounds the content size. Without this, fast streams left ~2-3px of
      // the answer's last line clipped under the window edge.
      const next = Math.ceil(rect.height + 28)
      void window.zanban.overlay.setContentHeight(next)
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    return () => ro.disconnect()
  }, [])

  // Safety re-measure on content-state transitions. ResizeObserver alone is
  // usually enough, but rapid state flips (alert appears + answer streams in
  // the same frame) sometimes settle to a height that ResizeObserver missed
  // because the entry was coalesced. Forcing a measure on the next frame
  // catches that case.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      void window.zanban.overlay.setContentHeight(Math.ceil(rect.height + 28))
    })
    return () => cancelAnimationFrame(id)
  }, [messages.length, latest?.answer.length, transcriptionError, apiKeysMissing])

  useEffect(() => {
    void window.zanban.overlay.getStealth().then(setStealth)
    void useSettingsStore.getState().load()
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    const offCap = wireCaptureAutostop()
    const offJobs = wireJobsIpc()
    // Live-sync settings from main — needed so toggles changed in the
    // dashboard (e.g. hideWidgetWhenHidden) take effect here without an app restart.
    const offSettings = wireSettingsIpc()

    function onMove(e: MouseEvent): void {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      // Three classes of pointer-active surfaces:
      //   1. our explicitly-tagged regions ([data-interactive])
      //   2. any open Radix popper / floating-ui portal (dropdown, popover,
      //      tooltip-with-pointer-events). These render outside our tree, so
      //      the [data-interactive] ancestor check from (1) misses them.
      //   3. role=menu / dialog — same reason, just structural fallback.
      const overInteractive = !!(
        el &&
        el.closest(
          '[data-interactive],[data-radix-popper-content-wrapper],[role="menu"],[role="menuitem"],[role="dialog"]'
        )
      )
      const next = !overInteractive
      if (ignoreMouseRef.current === next) return
      ignoreMouseRef.current = next
      window.zanban.overlay.setIgnoreMouse(next)
    }
    window.addEventListener('mousemove', onMove)

    const offAsk = window.zanban.overlay.onFocusAsk(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    const offAnswerLast = window.zanban.overlay.onAnswerLast(() => {
      handleAnswerRef.current()
    })

    const offSnapshot = window.zanban.overlay.onSnapshotAsk((snap) => {
      snapshotIdRef.current = snap.snapshotId
      setImage(snap.dataUrl)
      setOcrText(snap.ocrText)
      inputRef.current?.focus()
    })

    // One-shot "snap → answer" hotkey: don't touch the input attachment, just
    // fire the answer about the captured image. Empty prompt falls back to
    // SCREENSHOT_DEFAULT_PROMPT and the image triggers vision routing.
    const offSnapshotAnswer = window.zanban.overlay.onSnapshotAnswer((snap) => {
      void runPromptRef.current('', 'Screenshot answer', snap.dataUrl, false, snap.ocrText)
    })

    // Background OCR for an instant snapshot landed — fold it in only if the
    // attachment the user is looking at is still the one we captured.
    const offOcr = window.zanban.screenshot.onOcr((result) => {
      if (result.snapshotId === snapshotIdRef.current) {
        setOcrText(result.ocrText)
      }
    })

    const offStealth = window.zanban.overlay.onStealthChanged((next) => {
      setStealth(next)
    })

    return () => {
      offTr()
      offAi()
      offCap()
      offJobs()
      offAsk()
      offAnswerLast()
      offSnapshot()
      offSnapshotAnswer()
      offOcr()
      offStealth()
      offSettings()
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  async function toggleStealth(): Promise<void> {
    const next = await window.zanban.overlay.setStealth(!stealth)
    setStealth(next)
  }

  async function backToDashboard(): Promise<void> {
    stopCaptures()
    await window.zanban.session.stop().catch(() => {})
    await window.zanban.dashboard.show()
    await window.zanban.overlay.hide()
  }

  /**
   * Bring the dashboard window forward without touching the session.
   * Triggered by the brand lockup in the status pill — the user wants to
   * peek at history / settings while the recording keeps going.
   */
  async function openDashboardKeepSession(): Promise<void> {
    await window.zanban.dashboard.show()
  }

  async function stopSession(): Promise<void> {
    setStoppingSession(true)
    try {
      stopCaptures()
      await window.zanban.session.stop()
    } finally {
      setStoppingSession(false)
    }
  }

  // Settle-wait + ask + error handling + model-override all live in the shared
  // useAskRequest hook now, so the overlay and the dashboard AskPanel behave
  // identically (the dashboard used to skip the transcript settle).
  async function runPrompt(
    prompt: string,
    label?: string,
    imageDataUrl?: string,
    waitForTranscript?: boolean,
    ocr?: string | null
  ): Promise<void> {
    await runAsk({
      prompt,
      label,
      image: imageDataUrl ?? null,
      ocr,
      waitForTranscript,
      modelOverride
    })
  }

  useEffect(() => {
    runPromptRef.current = runPrompt
  })

  const handleAnswer = useCallback((): void => {
    void runPromptRef.current(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
  }, [])

  const handleAnswerRef = useRef(handleAnswer)
  useEffect(() => {
    handleAnswerRef.current = handleAnswer
  })

  async function send(): Promise<void> {
    const value = text.trim()
    const attached = image
    const ocrAttached = ocrText
    if (!value && !attached) return
    setText('')
    setImage(null)
    setOcrText(null)
    snapshotIdRef.current = null
    await runPrompt(value, undefined, attached ?? undefined, false, ocrAttached)
  }

  async function snap(): Promise<void> {
    if (snapping) return
    setSnapping(true)
    try {
      // Instant image, background OCR (F1/F5): the image attaches immediately;
      // the OCR text folds in via the onOcr subscription above.
      const snap = await window.zanban.screenshot.captureInstant()
      if (snap) {
        snapshotIdRef.current = snap.snapshotId
        setImage(snap.dataUrl)
        setOcrText(snap.ocrText)
        inputRef.current?.focus()
      }
    } finally {
      setSnapping(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const running = session.kind === 'running'
  const hasAnswer = !!latest
  const hasHistory = messages.length > 0
  const hasContent = hasHistory || apiKeysMissing || transcriptionError
  // Hide is now strictly "make me invisible to screen-share". It no longer
  // collapses the overlay's own UI: action chips, input, and answer pane
  // all stay rendered. The hideWidgetWhenHidden setting still affects the
  // dashboard's taskbar/Alt-Tab presence in main/index.ts; this overlay
  // simply ignores it.

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="pointer-events-none p-3"
        style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}
      >
        <div
          ref={panelRef}
          data-interactive
          className={cn(
            'pointer-events-auto mx-auto flex w-full flex-col gap-1.5',
            'max-w-[680px]'
          )}
        >
          <StatusBar
            running={running}
            busy={stoppingSession}
            elapsed={elapsed}
            stealth={stealth}
            onStop={() => void stopSession()}
            onToggleStealth={() => void toggleStealth()}
            onClose={() => void backToDashboard()}
            onOpenDashboard={() => void openDashboardKeepSession()}
          />

          <RollingTranscript />

          {/* Merged panel: chips → input → answer in ONE container. Per UX
              review the previous 4-surface stack was the highest-cost
              friction point during a live call — every Ask cycle made the
              eye traverse 4 floating boxes. One container, sections divided
              by 1px borders, same chrome as before. */}
          <div
            className={cn(
              'flex flex-col rounded-2xl border border-white/10',
              'bg-black/55 backdrop-blur-2xl backdrop-saturate-150 text-foreground',
              'shadow-2xl overflow-hidden'
            )}
          >
            <ActionChipsRow
              busy={busy}
              running={running}
              hasAnswer={hasAnswer}
              onWhatToAnswer={() =>
                void runPrompt(WHAT_TO_ANSWER_PROMPT, 'What to answer?', undefined, true)
              }
              onShorten={() => void runPrompt(SHORTEN_PROMPT, 'Shorten')}
              onRecap={() => void runPrompt(RECAP_PROMPT, 'Recap')}
              onFollowUp={() => void runPrompt(FOLLOW_UP_PROMPT, 'Follow-up')}
              onAnswer={handleAnswer}
            />

            <InputPill
              text={text}
              image={image}
              busy={busy}
              streaming={latest?.status === 'streaming'}
              snapping={snapping}
              inputRef={inputRef}
              onTextChange={setText}
              onKey={onKey}
              onSend={() => void send()}
              onStop={() => stopAsk()}
              onSnap={() => void snap()}
              onClearImage={() => {
                setImage(null)
                setOcrText(null)
                snapshotIdRef.current = null
              }}
              modelOverride={modelOverride}
              onModelChange={setModelOverride}
              activeProvider={settings?.llmProvider ?? 'vercel-gateway'}
              activeDefaultModel={
                settings?.aiModels?.[settings.llmProvider]?.fast ||
                (settings ? PROVIDER_MODEL_DEFAULTS[settings.llmProvider].fast : '')
              }
              screenshotHotkey={settings?.hotkeys?.screenshot ?? null}
            />

            {hasContent && (
              <div className="flex flex-col gap-2 border-t border-white/10 px-3 py-2.5">
                {(apiKeysMissing || transcriptionError) && (
                  <div className="space-y-2">
                    {apiKeysMissing && (
                      <Alert
                        variant="default"
                        className="bg-amber-500/10 border-amber-500/30 text-amber-200"
                      >
                        <AlertTriangle className="size-4 text-amber-400" />
                        <AlertTitle>{t('overlay.api_keys_missing_title')}</AlertTitle>
                        <AlertDescription>
                          {t('overlay.api_keys_missing_body', {
                            providers: missingProviders.join(', ')
                          })}{' '}
                          <button
                            className="underline underline-offset-2"
                            onClick={() => void refreshSettings()}
                          >
                            {t('overlay.recheck')}
                          </button>
                        </AlertDescription>
                      </Alert>
                    )}
                    {transcriptionError && (
                      <Alert variant="destructive">
                        <AlertTriangle className="size-4" />
                        <AlertTitle>{t('overlay.transcription_error')}</AlertTitle>
                        <AlertDescription>{transcriptionError}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {hasHistory && (
                  <div
                    ref={historyRef}
                    data-interactive
                    style={{ maxHeight: `${userMaxHeight}px` }}
                    className="flex min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-1 py-1"
                  >
                    {messages.map((m) => (
                      <AnswerPane
                        key={m.id}
                        message={m}
                        onContinue={() => void runPrompt('continue', 'Continue')}
                      />
                    ))}
                  </div>
                )}
                {hasHistory && (
                  <AnswerPaneResizer
                    value={userMaxHeight}
                    hardCap={hardCap}
                    onChange={setUserMaxHeight}
                    onCommit={commitAnswerMaxHeight}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        <Toaster theme="dark" />
      </div>
    </TooltipProvider>
  )
}

function StatusBar({
  running,
  busy,
  elapsed,
  stealth,
  onStop,
  onToggleStealth,
  onClose,
  onOpenDashboard
}: {
  running: boolean
  busy: boolean
  elapsed: string
  stealth: boolean
  onStop: () => void
  onToggleStealth: () => void
  onClose: () => void
  onOpenDashboard: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border border-white/10',
        'bg-black/55 px-2 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Brand lockup — clickable. Acts as the "back to dashboard" affordance,
          but unlike the X close it KEEPS the session running. Used when the
          user wants to peek at settings / past sessions mid-call. Sits a hair
          above baseline (-translate-y-px) for visual lift like the natively
          mark, and paints in solid foreground so it reads at a glance against
          dark meeting tiles. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-interactive
            onClick={onOpenDashboard}
            aria-label={t('overlay.open_dashboard_keep_session')}
            className={cn(
              'group flex h-7 w-7 -translate-y-px items-center justify-center rounded-full',
              'text-foreground transition-all',
              'hover:bg-white/[0.08] hover:-translate-y-0.5 hover:scale-105',
              'active:scale-95'
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ZanbanMark size={18} signal={running ? 'oklch(0.72 0.18 25)' : undefined} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('overlay.open_dashboard_keep_session')}</TooltipContent>
      </Tooltip>
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {running ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-interactive
                onClick={onStop}
                disabled={busy}
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5',
                  'border border-primary/30 bg-primary/10 font-mono text-[10px] text-primary',
                  'hover:bg-primary/15 hover:border-primary/50 transition-colors'
                )}
              >
                {/* Slower pulse (1.6s) — calmer than the default 1s; matches
                    the "doesn't want to be seen" stealth posture. */}
                <span className="inline-flex size-1.5 rounded-full bg-primary motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]" />
                {elapsed}
                <Square className="ml-0.5 size-2.5 fill-current" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('overlay.stop_recording_tooltip')}</TooltipContent>
          </Tooltip>
        ) : (
          <span
            data-interactive
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 font-mono text-[10px] text-muted-foreground"
          >
            <span className="inline-flex size-1.5 rounded-full bg-muted-foreground/40" />
            {t('overlay.idle')}
          </span>
        )}

        <span data-interactive>
          <JobsBadge />
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 gap-1 px-2 text-[11px] font-mono lowercase tracking-tight',
                // Stealth-on (invisible to others) = calm default. Stealth-off
                // (visible to screen-share) = amber warning. We label the
                // STATE itself so the user doesn't have to translate
                // "visible" into "uh-oh, others can see this".
                stealth ? 'text-muted-foreground hover:text-foreground' : 'text-amber-300'
              )}
              onClick={onToggleStealth}
            >
              {stealth ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              <span>{stealth ? t('overlay.stealth_on') : t('overlay.stealth_off')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {stealth ? t('overlay.stealth_on_tooltip') : t('overlay.stealth_off_tooltip')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('overlay.back_to_dashboard')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function ActionChipsRow({
  busy,
  running,
  hasAnswer,
  onWhatToAnswer,
  onShorten,
  onRecap,
  onFollowUp,
  onAnswer
}: {
  busy: boolean
  running: boolean
  hasAnswer: boolean
  onWhatToAnswer: () => void
  onShorten: () => void
  onRecap: () => void
  onFollowUp: () => void
  onAnswer: () => void
}) {
  const { t } = useTranslation()
  // Two disable axes, made explicit so the rules aren't opaque:
  //   - requires-session: Answer, Recap, What-to-answer — useless with no live
  //     transcript. Answer USED to be always-on (it could conjure an answer
  //     "from nowhere"); it now needs a running session like the rest.
  //   - requires-answer: Shorten, Follow-up, Continue — operate on an existing
  //     answer, so they need one to exist.
  // Each disabled chip carries a tooltip explaining WHY, so the user isn't left
  // guessing why a control is greyed out.
  const needsSession = t('overlay.chips.disabled_needs_session')
  const needsAnswer = t('overlay.chips.disabled_needs_answer')
  const sessionReason = !running ? needsSession : undefined
  const answerReason = !hasAnswer ? needsAnswer : undefined
  // Hierarchy revamp: 5 equally-weighted chips → 2 visible primaries (Answer
  // + Recap) and a `more` dropdown for the rest. Reduces eye-traversal cost
  // during a live call where attention is already fragmented.
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Recap is the most-used "look back at the last 90s" gesture. Requires a
          session — there's no transcript to recap when idle. */}
      <ActionChip
        label={t('overlay.chips.recap')}
        disabled={busy || !running}
        disabledReason={sessionReason}
        onClick={onRecap}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-interactive
            disabled={busy}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px] transition-colors',
              'border border-white/10 bg-white/[0.04] text-foreground/85',
              'hover:bg-white/[0.08] hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            {t('overlay.more')}
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          data-interactive
          className="min-w-[200px] border-white/10 bg-[#111114]/95 backdrop-blur-xl"
        >
          <DropdownMenuItem
            disabled={busy || !running}
            onSelect={onWhatToAnswer}
            title={sessionReason}
          >
            <span className="text-[12px]">{t('overlay.chips.what_to_answer')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy || !hasAnswer} onSelect={onShorten} title={answerReason}>
            <span className="text-[12px]">{t('overlay.chips.shorten')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || !hasAnswer}
            onSelect={onFollowUp}
            title={answerReason}
          >
            <span className="text-[12px]">{t('overlay.chips.follow_up')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="flex-1" />

      {/* Answer — single primary CTA. Now requires a session: answering "the
          last question" is meaningless without a live transcript. */}
      <ActionChip
        label={t('overlay.chips.answer')}
        emphasis
        disabled={busy || !running}
        disabledReason={sessionReason}
        onClick={onAnswer}
      />
    </div>
  )
}

function ActionChip({
  label,
  emphasis,
  disabled,
  disabledReason,
  onClick
}: {
  label: string
  emphasis?: boolean
  disabled?: boolean
  /** Why the chip is disabled. When present (and disabled), shown as a tooltip. */
  disabledReason?: string
  onClick: () => void
}) {
  const chip = (
    <button
      data-interactive
      onClick={onClick}
      disabled={disabled}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'inline-flex h-7 items-center rounded-full px-3 text-[11px] transition-colors',
        emphasis
          ? 'bg-foreground text-background hover:bg-foreground/90 font-medium'
          : 'border border-white/10 bg-white/[0.04] text-foreground/85 hover:bg-white/[0.08] hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-40'
      )}
    >
      {label}
    </button>
  )
  // Tooltip only when we actually have a reason to show — a disabled button
  // swallows pointer events, so wrap in a span the Tooltip can hang off of.
  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-interactive className="inline-flex">
            {chip}
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    )
  }
  return chip
}

function ModelOverridePicker({
  value,
  onChange,
  provider,
  defaultModel,
  noDrag
}: {
  value: string | null
  onChange: (m: string | null) => void
  /** Currently active LLM provider. Determines which model list to show. */
  provider: LlmProvider
  /** Current default model for `fast` role under `provider` — shown in trigger. */
  defaultModel: string
  noDrag: React.CSSProperties
}) {
  const { t } = useTranslation()
  const fastModels = PROVIDER_FAST_MODELS[provider] ?? []
  const visionModels = PROVIDER_VISION_MODELS[provider] ?? []

  const label = value
    ? value.includes('/')
      ? (value.split('/').pop() ?? value)
      : value
    : t('overlay.model_picker.default')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-interactive
        style={noDrag}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10',
          'bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground',
          'hover:bg-white/[0.08] hover:text-foreground transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20'
        )}
        title={t('overlay.model_picker.tooltip', { provider })}
      >
        <span className="max-w-[110px] truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Radix renders this in a portal outside our main tree, so the
        // overlay's mouse-region detector can't see it via [data-interactive]
        // on ancestors. Mark it explicitly so clicks on items don't get
        // forwarded through the click-through window.
        data-interactive
        className="min-w-[200px] border-white/10 bg-[#111114]/95 backdrop-blur-xl"
      >
        <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
          {t('overlay.model_picker.override_label', { provider })}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className={cn('flex-1 truncate text-[12px]', !value && 'text-foreground')}>
            {t('overlay.model_picker.default')} ·{' '}
            <span className="font-mono text-[10px] text-muted-foreground">{defaultModel}</span>
          </span>
          {!value && <span className="text-[10px] text-emerald-400">●</span>}
        </DropdownMenuItem>
        {fastModels.length > 0 && <DropdownMenuSeparator />}
        {fastModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            {t('overlay.model_picker.text_answers')}
          </DropdownMenuLabel>
        )}
        {fastModels.map((m) => (
          <DropdownMenuItem key={`f-${m}`} onSelect={() => onChange(m)}>
            <span
              className={cn(
                'flex-1 truncate font-mono text-[11px]',
                value === m && 'text-foreground'
              )}
            >
              {m}
            </span>
            {value === m && <span className="text-[10px] text-emerald-400">●</span>}
          </DropdownMenuItem>
        ))}
        {visionModels.length > 0 && <DropdownMenuSeparator />}
        {visionModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            {t('overlay.model_picker.vision')}
          </DropdownMenuLabel>
        )}
        {visionModels.map((m) => (
          <DropdownMenuItem key={`v-${m}`} onSelect={() => onChange(m)}>
            <span
              className={cn(
                'flex-1 truncate font-mono text-[11px]',
                value === m && 'text-foreground'
              )}
            >
              {m}
            </span>
            {value === m && <span className="text-[10px] text-emerald-400">●</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InputPill({
  text,
  image,
  busy,
  streaming,
  snapping,
  inputRef,
  onTextChange,
  onKey,
  onSend,
  onStop,
  onSnap,
  onClearImage,
  modelOverride,
  onModelChange,
  activeProvider,
  activeDefaultModel,
  screenshotHotkey
}: {
  text: string
  image: string | null
  busy: boolean
  streaming: boolean
  snapping: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onTextChange: (v: string) => void
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onStop: () => void
  onSnap: () => void
  onClearImage: () => void
  modelOverride: string | null
  onModelChange: (m: string | null) => void
  activeProvider: LlmProvider
  activeDefaultModel: string
  /** Configured screenshot accelerator (e.g. "Control+Shift+S"); null until settings load. */
  screenshotHotkey: string | null
}) {
  const { t } = useTranslation()
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  // Render the REAL screenshot chord from settings, not a hardcoded ⌘+H (which
  // is wrong on Windows and clashed with the hideShow 'H' binding). Falls back
  // to a camera glyph if no binding is set.
  const snapTokens = screenshotHotkey ? acceleratorTokens(screenshotHotkey) : []
  const snapChord = snapTokens.length > 0 ? snapTokens.join(' + ') : t('overlay.input.snap_tooltip')
  return (
    <div
      className="flex items-center gap-2 border-t border-white/10 px-3 py-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {image && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-interactive
              onClick={onClearImage}
              style={noDrag}
              className="group relative shrink-0"
              title={t('overlay.input.remove_screenshot')}
            >
              <img
                src={image}
                alt="screenshot"
                className="h-8 w-auto rounded border border-white/20 object-cover"
              />
              <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-white/30 bg-black/80 opacity-0 transition-opacity group-hover:opacity-100">
                <X className="size-2 text-white" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('overlay.input.screenshot_attached_tooltip')}</TooltipContent>
        </Tooltip>
      )}
      <textarea
        data-interactive
        ref={inputRef}
        rows={1}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKey}
        placeholder={image ? t('overlay.ask_about_screenshot') : t('overlay.ask_placeholder')}
        style={noDrag}
        className={cn(
          'flex-1 resize-none bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground/60',
          'border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'
        )}
      />
      <ModelOverridePicker
        value={modelOverride}
        onChange={onModelChange}
        provider={activeProvider}
        defaultModel={activeDefaultModel}
        noDrag={noDrag}
      />
      {!image && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-interactive
              onClick={onSnap}
              disabled={snapping || busy}
              style={noDrag}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border border-white/10',
                'bg-white/5 px-1.5 font-mono text-[10px] text-muted-foreground',
                'hover:bg-white/10 hover:text-foreground transition-colors',
                'disabled:opacity-50'
              )}
            >
              {snapping ? (
                <Loader2 className="size-3 animate-spin" />
              ) : snapTokens.length > 0 ? (
                snapTokens.map((tok, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <span>+</span>}
                    <Kbd>{tok}</Kbd>
                  </span>
                ))
              ) : (
                <Camera className="size-3" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {snapTokens.length > 0
              ? t('overlay.input.snap_hotkey_tooltip', { chord: snapChord })
              : t('overlay.input.snap_tooltip')}
          </TooltipContent>
        </Tooltip>
      )}
      {streaming ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              onClick={onStop}
              size="icon"
              variant="destructive"
              style={noDrag}
              className="size-7 shrink-0 rounded-full"
            >
              <Square className="size-3 fill-current" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('overlay.stop_generating')}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          data-interactive
          onClick={onSend}
          disabled={busy || (!text.trim() && !image)}
          size="icon"
          variant={text.trim() || image ? 'default' : 'ghost'}
          style={noDrag}
          className="size-7 shrink-0 rounded-full"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </Button>
      )}
    </div>
  )
}

interface AskMessage {
  id: string
  prompt: string
  answer: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  finishReason?: string
}

function AnswerPane({ message: m, onContinue }: { message: AskMessage; onContinue: () => void }) {
  const { t } = useTranslation()
  const canCopy = m.status !== 'error' && m.answer.length > 0
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {m.prompt}
        </div>
        {canCopy && (
          <button
            data-interactive
            onClick={() => void copyToClipboard(m.answer, t('ask_panel.copy_toast'))}
            title={t('overlay.copy_answer')}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded',
              'size-5 text-muted-foreground/70 hover:bg-white/10 hover:text-foreground'
            )}
          >
            <Copy className="size-3" />
          </button>
        )}
      </div>
      {m.status === 'error' ? (
        <div className="text-xs text-destructive">{m.error}</div>
      ) : (
        <StreamingMarkdown text={m.answer} />
      )}
      {m.status === 'streaming' && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          {t('overlay.streaming')}
        </div>
      )}
      {m.status === 'done' && m.finishReason === 'length' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
          <span className="flex-1">{t('overlay.answer_truncated')}</span>
          <button
            data-interactive
            onClick={onContinue}
            title={t('overlay.continue_tooltip')}
            className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 hover:bg-amber-500/20"
          >
            <ArrowDownToLine className="size-3" />
            {t('overlay.continue')}
          </button>
        </div>
      )}
    </div>
  )
}

function useElapsed(running: boolean, t0?: number | null): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])
  if (!running || !t0) return '00:00'
  const s = Math.floor((now - t0) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
