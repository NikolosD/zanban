import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Send,
  AlertTriangle,
  EyeOff,
  Eye,
  Square,
  Loader2,
  ChevronDown,
  ChevronRight,
  Copy,
  ArrowDownToLine,
  Camera,
  GripVertical
} from 'lucide-react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
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
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { wireAiIpc, useAi } from '@renderer/features/ai/store'
import { useAskRequest, type AskRequestOptions } from '@renderer/features/ai/useAskRequest'
import { useAutoAnswer } from '@renderer/features/ai/useAutoAnswer'
import { useScreenshotAttachment } from '@renderer/features/ai/useScreenshotAttachment'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { CodeBlockContext, type CodeBlockOptions } from '@renderer/features/ai/CodeBlock'
import { useSettingsStore, wireSettingsIpc } from '@renderer/features/settings/store'
import { missingProviderNames } from '@renderer/features/settings/providerStatus'
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
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Toaster } from '@renderer/components/ui/sonner'
import { toast } from 'sonner'
import { useAvailableModels } from '@renderer/features/ai/useAvailableModels'
import { Kbd } from '@renderer/components/ui/kbd'
import { acceleratorTokens } from '@renderer/features/settings/KeyRecorder'
import { cn } from '@renderer/lib/utils'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { compactHotkeyTokens } from '@renderer/lib/hotkeys'
import { stopCaptures, wireCaptureAutostop } from '@renderer/audio/captureController'
import { toastSessionError } from '@renderer/features/transcript/sessionStart'
import { ZanbanMark } from '@renderer/components/brand'
import { OverlayResizeGrip } from './OverlayResizeGrip'
import { useOverlayDrag } from './overlayDrag'
import { ExpandedCodeView } from './ExpandedCode'
import { scrollPage } from './scrollPage'
import { useExpandedCode } from './useExpandedCode'
import { DEFAULT_ANSWER_MAX_HEIGHT, clampAnswerHeight, computeHardCap } from './answerPaneResize'
import { AnswerScroller } from './AnswerScroller'
import { splitAnswerLead } from './answerLead'
import { TranscriptOrNotice } from './CaptureNoticeLine'
import { useCaptureNotices, wireCaptureNotices } from './captureNotices'
import { ANSWER_SURFACE, GLASS_PANEL, GLASS_PILL, overlayGlassVars } from './glass'

type LayoutKey = 'overlayAnswerMaxHeight' | 'overlayWidth'

export function OverlayApp() {
  const { t } = useTranslation()
  const [stealth, setStealth] = useState(true)
  const [visible, setVisible] = useState(true)
  const [text, setText] = useState('')
  const { run: runAsk, stop: stopAsk, busy } = useAskRequest()
  const [stoppingSession, setStoppingSession] = useState(false)
  const attachment = useScreenshotAttachment()
  const { image, attach: attachSnapshot, clear: clearAttachment } = attachment
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const runPromptRef = useRef<(opts: AskRequestOptions) => Promise<void>>(() => Promise.resolve())
  const ignoreMouseRef = useRef<boolean | null>(null)
  const session = useTranscript((s) => s.session)
  const startedAt = session.kind === 'running' ? session.startedAt : null
  const running = startedAt !== null
  const sessionPending = session.kind === 'starting' || session.kind === 'stopping'
  const settings = useSettingsStore((s) => s.settings)
  const refreshSettings = useSettingsStore((s) => s.load)
  const status = useTranscript((s) => s.status)
  // Narrow selectors on purpose: answer text is read only inside AnswerHistory,
  // so streamed tokens don't re-render this whole tree.
  const hasHistory = useAi((s) => s.messages.length > 0)
  const hasAnswer = useAi((s) => s.messages.some((m) => m.answer.length > 0))
  const streaming = useAi((s) => s.messages.at(-1)?.status === 'streaming')

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
  const [adopted, setAdopted] = useState<{ persisted: number; cap: number } | null>(null)
  if (adopted?.persisted !== persistedAnswerMax || adopted.cap !== hardCap) {
    setAdopted({ persisted: persistedAnswerMax, cap: hardCap })
    setUserMaxHeight(clampAnswerHeight(persistedAnswerMax, hardCap))
  }

  const persistTimers = useRef<Partial<Record<LayoutKey, ReturnType<typeof setTimeout>>>>({})
  const persistLayout = useCallback((key: LayoutKey, next: number) => {
    clearTimeout(persistTimers.current[key])
    persistTimers.current[key] = setTimeout(() => {
      void window.zanban.settings.set({ [key]: next })
    }, 300)
  }, [])
  const commitAnswerMaxHeight = useCallback(
    (next: number) => persistLayout('overlayAnswerMaxHeight', next),
    [persistLayout]
  )
  const commitOverlayWidth = useCallback(
    (next: number) => persistLayout('overlayWidth', next),
    [persistLayout]
  )
  const resizeOverlayWidth = useCallback((next: number) => {
    void window.zanban.overlay.setWidth(next)
  }, [])

  useEffect(
    () => () => {
      for (const timer of Object.values(persistTimers.current)) clearTimeout(timer)
    },
    []
  )
  const startDrag = useOverlayDrag()
  const answerScrollRef = useRef<HTMLDivElement>(null)
  const expandedScrollRef = useRef<HTMLDivElement>(null)
  const {
    expanded,
    expand,
    update,
    collapse: collapseCode,
    toggle: toggleCode
  } = useExpandedCode(answerScrollRef)
  const expandedId = expanded?.id ?? null
  const codeBlockOptions = useMemo<CodeBlockOptions>(
    () => ({ onExpand: (block) => void expand(block), expandedId, onUpdate: update }),
    [expand, expandedId, update]
  )
  const expandedRef = useRef(expanded)
  useEffect(() => {
    expandedRef.current = expanded
  })
  useEffect(() => {
    if (!visible) void collapseCode()
  }, [visible, collapseCode])

  const transcriptionError =
    status.mic?.kind === 'error'
      ? status.mic.message
      : status.system?.kind === 'error'
        ? status.system.message
        : null

  const missingProviders = settings ? missingProviderNames(settings) : []
  const apiKeysMissing = missingProviders.length > 0
  const activeProvider = settings?.llmProvider ?? 'vercel-gateway'
  const activeDefaultModel =
    settings?.aiModels?.[settings.llmProvider]?.fast ||
    (settings ? PROVIDER_MODEL_DEFAULTS[settings.llmProvider].fast : '')

  // Auto-grow the OS window to fit the visible panel. Mirrors the approach
  // used in natively-cluely-ai-assistant: useLayoutEffect runs before paint,
  // sends dimensions directly (no rAF throttle) so streaming answers don't
  // get clipped by a frame-late IPC. Main clamps to the work area, so very
  // long answers fall back to internal scrolling rather than running
  // off-screen.
  const measurePanel = useCallback((): void => {
    const el = panelRef.current
    if (!el) return
    // 28px = outer p-3 padding above and below the panel (12px each), plus
    // an extra 4px so the rounded bottom border isn't shaved when the OS
    // rounds the content size. Without this, fast streams left ~2-3px of
    // the answer's last line clipped under the window edge.
    void window.zanban.overlay.setContentHeight(Math.ceil(el.getBoundingClientRect().height + 28))
  }, [])

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(measurePanel)
    ro.observe(el)
    measurePanel()
    return () => ro.disconnect()
  }, [measurePanel])

  // Safety re-measure on content-state transitions. ResizeObserver alone is
  // usually enough, but rapid state flips (alert appears + answer streams in
  // the same frame) sometimes settle to a height that ResizeObserver missed
  // because the entry was coalesced. Forcing a measure on the next frame
  // catches that case. AnswerHistory does the same per streamed chunk.
  useEffect(() => {
    const id = requestAnimationFrame(measurePanel)
    return () => cancelAnimationFrame(id)
  }, [transcriptionError, apiKeysMissing, measurePanel])

  // Labels are resolved through the i18n instance at call time: these callbacks
  // outlive renders (IPC subscriptions, memoized panes) and the UI language
  // switches after mount, once settings load.
  const handleAnswer = useCallback((): void => {
    void runPromptRef.current({
      prompt: ANSWER_LAST_PROMPT,
      label: i18n.t('overlay.labels.answer_last'),
      waitForTranscript: true
    })
  }, [])

  const continueAnswer = useCallback((id: string): void => {
    void runPromptRef.current({ prompt: 'continue', continueFrom: id })
  }, [])

  const autoAnswer = settings?.autoAnswer ?? false
  const answerDetectedQuestion = useCallback((question: string): void => {
    void runPromptRef.current({
      prompt: ANSWER_LAST_PROMPT,
      label: i18n.t('overlay.labels.answer_last'),
      waitForTranscript: true,
      question
    })
  }, [])
  useAutoAnswer({ enabled: autoAnswer && visible, busy, ask: answerDetectedQuestion })

  useEffect(() => {
    void window.zanban.overlay.getStealth().then(setStealth)
    void useSettingsStore.getState().load()
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    const offCap = wireCaptureAutostop()
    const offNotices = wireCaptureNotices()
    // Live-sync settings from main — needed so toggles changed in the
    // dashboard (e.g. hideWidgetWhenHidden) take effect here without an app restart.
    const offSettings = wireSettingsIpc()
    const offReplaced = window.zanban.ai.onModelReplaced(({ from, to }) =>
      toast.info(i18n.t('overlay.model_replaced', { from, to }))
    )

    function onMove(e: MouseEvent): void {
      // A held button means a drag or resize is under way; flipping click-through
      // mid-gesture would drop the mouse capture.
      if (e.buttons !== 0) return
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

    const offAnswerLast = window.zanban.overlay.onAnswerLast(handleAnswer)

    const offScroll = window.zanban.overlay.onScrollAnswer((direction) =>
      scrollPage(
        expandedRef.current ? expandedScrollRef.current : answerScrollRef.current,
        direction
      )
    )
    const offExpandCode = window.zanban.overlay.onToggleExpandCode(toggleCode)

    const offSnapshot = window.zanban.overlay.onSnapshotAsk((snap) => {
      attachSnapshot(snap)
      inputRef.current?.focus()
    })

    // One-shot "snap → answer" hotkey: don't touch the input attachment, just
    // fire the answer about the captured image. Empty prompt falls back to
    // SCREENSHOT_DEFAULT_PROMPT and the image triggers vision routing.
    const offSnapshotAnswer = window.zanban.overlay.onSnapshotAnswer((snap) => {
      void runPromptRef.current({
        prompt: '',
        label: i18n.t('overlay.labels.screenshot_answer'),
        image: snap.dataUrl,
        ocr: snap.ocrText
      })
    })

    const offStealth = window.zanban.overlay.onStealthChanged((next) => {
      setStealth(next)
    })

    const offVisible = window.zanban.overlay.onVisibilityChanged(setVisible)

    return () => {
      offTr()
      offAi()
      offCap()
      offNotices()
      offAsk()
      offAnswerLast()
      offScroll()
      offExpandCode()
      offSnapshot()
      offSnapshotAnswer()
      offStealth()
      offVisible()
      offSettings()
      offReplaced()
      window.removeEventListener('mousemove', onMove)
    }
  }, [handleAnswer, attachSnapshot, toggleCode])

  async function toggleStealth(): Promise<void> {
    const next = await window.zanban.overlay.setStealth(!stealth)
    setStealth(next)
  }

  async function collapse(): Promise<void> {
    if (!running) await window.zanban.dashboard.show()
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
    } catch (err) {
      toastSessionError(t('dashboard.toasts.could_not_stop'), err)
    } finally {
      setStoppingSession(false)
    }
  }

  // Settle-wait + ask + error handling + model-override all live in the shared
  // useAskRequest hook now, so the overlay and the dashboard AskPanel behave
  // identically (the dashboard used to skip the transcript settle).
  async function runPrompt(opts: AskRequestOptions): Promise<void> {
    await runAsk({ ...opts, modelOverride })
  }

  useEffect(() => {
    runPromptRef.current = runPrompt
  })

  // Esc stops the answer wherever the focus is; the input handles its own Esc.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (useAi.getState().messages.at(-1)?.status === 'streaming') stopAsk()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stopAsk])

  function clearInput(): void {
    setText('')
    clearAttachment()
  }

  async function send(): Promise<void> {
    const value = text.trim()
    const attached = image
    const ocrAttached = attachment.ocrText
    if ((!value && !attached) || busy) return
    clearInput()
    await runPrompt({ prompt: value, image: attached, ocr: ocrAttached })
  }

  async function snap(): Promise<void> {
    if (await attachment.snap()) inputRef.current?.focus()
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (streaming) stopAsk()
      else clearInput()
    }
  }

  const hasContent = hasHistory || apiKeysMissing
  // Hide is now strictly "make me invisible to screen-share". It no longer
  // collapses the overlay's own UI: action chips, input, and answer pane
  // all stay rendered. The hideWidgetWhenHidden setting still affects the
  // dashboard's taskbar/Alt-Tab presence in main/index.ts; this overlay
  // simply ignores it.

  return (
    <CodeBlockContext.Provider value={codeBlockOptions}>
      <TooltipProvider delayDuration={250}>
        <div
          className="pointer-events-none p-3"
          style={{
            height: '100vh',
            width: '100vw',
            overflow: 'hidden',
            ...overlayGlassVars(settings?.overlayOpacity ?? 1)
          }}
        >
          <div
            ref={panelRef}
            data-interactive
            onMouseDown={expanded ? undefined : startDrag}
            className={cn(
              'pointer-events-auto flex w-full flex-col gap-1.5',
              expanded ? 'h-full cursor-auto' : 'cursor-move'
            )}
          >
            <StatusBar
              startedAt={startedAt}
              busy={stoppingSession}
              sessionPending={sessionPending}
              stealth={stealth}
              toggleHotkey={settings?.hotkeys?.toggleOverlay ?? null}
              sessionHotkey={settings?.hotkeys?.toggleSession ?? null}
              onStart={() => void window.zanban.session.requestToggle()}
              onStop={() => void stopSession()}
              onToggleStealth={() => void toggleStealth()}
              onCollapse={() => void collapse()}
              onOpenDashboard={() => void openDashboardKeepSession()}
            />

            {/* One container, sections divided by 1px rules. The answer comes
              first: during heads-up it is the one thing the user reads, so it
              sits right under the status pill; the transcript line, chips and
              input are secondary and follow it. */}
            <div
              className={cn(
                'relative flex flex-col rounded-2xl border border-white/10',
                GLASS_PANEL,
                'text-foreground shadow-2xl overflow-hidden',
                expanded && 'min-h-0 flex-1'
              )}
            >
              {expanded && (
                <ExpandedCodeView
                  block={expanded}
                  scrollRef={expandedScrollRef}
                  onCollapse={() => void collapseCode()}
                />
              )}
              <div className={cn('flex flex-col divide-y divide-white/10', expanded && 'hidden')}>
                {hasContent && (
                  <div className={cn('flex flex-col gap-2 px-3 py-2.5', ANSWER_SURFACE)}>
                    {apiKeysMissing && (
                      <div className="space-y-2">
                        {apiKeysMissing && (
                          <Alert variant="default" className="border-warn/30 bg-warn/10 text-warn">
                            <AlertTriangle className="size-4 text-warn" />
                            <AlertTitle>{t('overlay.api_keys_missing_title')}</AlertTitle>
                            <AlertDescription>
                              {t('overlay.api_keys_missing_body', {
                                providers: missingProviders.join(', ')
                              })}{' '}
                              <span className="flex items-center gap-1.5">
                                <button
                                  className="underline underline-offset-2"
                                  onClick={() => void openDashboardKeepSession()}
                                >
                                  {t('overlay.open_dashboard')}
                                </button>
                                <span aria-hidden>·</span>
                                <button
                                  className="underline underline-offset-2"
                                  onClick={() => void refreshSettings()}
                                >
                                  {t('overlay.recheck')}
                                </button>
                              </span>
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}

                    {hasHistory && (
                      <AnswerHistory
                        maxHeight={userMaxHeight}
                        scrollRef={answerScrollRef}
                        onContinue={continueAnswer}
                        onContentChange={measurePanel}
                      />
                    )}
                  </div>
                )}

                <TranscriptOrNotice error={transcriptionError} />

                {running && (
                  <ActionChipsRow
                    busy={busy}
                    hasAnswer={hasAnswer}
                    answerHotkey={settings?.hotkeys?.answerLast ?? null}
                    onWhichQuestion={() =>
                      void runPrompt({
                        prompt: WHAT_TO_ANSWER_PROMPT,
                        label: t('overlay.chips.which_question'),
                        waitForTranscript: true
                      })
                    }
                    onShorten={() =>
                      void runPrompt({ prompt: SHORTEN_PROMPT, label: t('overlay.chips.shorten') })
                    }
                    onCatchUp={() =>
                      void runPrompt({ prompt: RECAP_PROMPT, label: t('overlay.chips.catch_up') })
                    }
                    onFollowUp={() =>
                      void runPrompt({
                        prompt: FOLLOW_UP_PROMPT,
                        label: t('overlay.chips.follow_up')
                      })
                    }
                    onAnswer={handleAnswer}
                    autoAnswer={autoAnswer}
                    onToggleAutoAnswer={() =>
                      void window.zanban.settings.set({ autoAnswer: !autoAnswer })
                    }
                    modelMenu={
                      <ModelOverrideSubmenu
                        value={modelOverride}
                        onChange={setModelOverride}
                        provider={activeProvider}
                        defaultModel={activeDefaultModel}
                      />
                    }
                  />
                )}

                <InputPill
                  text={text}
                  image={image}
                  busy={busy}
                  streaming={streaming}
                  snapping={attachment.snapping}
                  inputRef={inputRef}
                  onTextChange={setText}
                  onKey={onKey}
                  onSend={() => void send()}
                  onStop={stopAsk}
                  onSnap={() => void snap()}
                  onClearImage={clearAttachment}
                  modelOverride={modelOverride}
                  onModelChange={setModelOverride}
                  activeProvider={activeProvider}
                  activeDefaultModel={activeDefaultModel}
                  screenshotHotkey={settings?.hotkeys?.screenshot ?? null}
                  askHotkey={settings?.hotkeys?.askAi ?? null}
                />
              </div>
              <OverlayResizeGrip
                answerHeight={userMaxHeight}
                hardCap={hardCap}
                onWidthChange={resizeOverlayWidth}
                onHeightChange={setUserMaxHeight}
                onWidthCommit={commitOverlayWidth}
                onHeightCommit={commitAnswerMaxHeight}
              />
            </div>
          </div>
          <Toaster theme="dark" />
        </div>
      </TooltipProvider>
    </CodeBlockContext.Provider>
  )
}

function StatusBar({
  startedAt,
  busy,
  sessionPending,
  stealth,
  toggleHotkey,
  sessionHotkey,
  onStart,
  onStop,
  onToggleStealth,
  onCollapse,
  onOpenDashboard
}: {
  /** Session start time; null while idle. */
  startedAt: number | null
  busy: boolean
  /** The session is starting or stopping. */
  sessionPending: boolean
  stealth: boolean
  /** Configured show/hide-overlay accelerator; null until settings load. */
  toggleHotkey: string | null
  /** Configured start/stop-session accelerator; null until settings load. */
  sessionHotkey: string | null
  onStart: () => void
  onStop: () => void
  onToggleStealth: () => void
  onCollapse: () => void
  onOpenDashboard: () => void
}) {
  const { t } = useTranslation()
  const running = startedAt !== null
  const toggleTokens = toggleHotkey ? acceleratorTokens(toggleHotkey) : []
  const collapseLabel = !running
    ? t('overlay.hide_to_dashboard')
    : toggleTokens.length > 0
      ? t('overlay.hide_keep_recording', { chord: toggleTokens.join(' + ') })
      : t('overlay.hide_keep_recording_tray')
  return (
    <div
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border border-white/10 px-2 py-1 shadow-xl',
        GLASS_PILL
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex h-7 w-4 shrink-0 items-center justify-center text-muted-foreground/70">
            <GripVertical className="size-3.5" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('overlay.drag_to_move')}</TooltipContent>
      </Tooltip>
      {/* Brand lockup — clickable. Brings the dashboard forward and KEEPS the
          session running. Used when the user wants to peek at settings / past
          sessions mid-call. Sits a hair above baseline (-translate-y-px) for
          visual lift like the natively mark, and paints in solid foreground so
          it reads at a glance against dark meeting tiles. */}
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
          >
            <ZanbanMark size={18} signal={running ? 'oklch(0.72 0.18 25)' : undefined} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('overlay.open_dashboard_keep_session')}</TooltipContent>
      </Tooltip>
      <div className="flex items-center gap-1">
        {startedAt !== null ? (
          <RecordingChip startedAt={startedAt} busy={busy} onStop={onStop} />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-interactive
                onClick={onStart}
                disabled={sessionPending}
                aria-label={t('overlay.start_tooltip')}
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5',
                  'border border-white/15 bg-white/[0.06] font-mono text-small text-foreground',
                  'transition-colors hover:bg-white/[0.1] disabled:opacity-60'
                )}
              >
                {sessionPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="inline-flex size-1.5 rounded-full bg-muted-foreground" />
                )}
                {t('overlay.start')}
                {sessionHotkey && (
                  <HotkeyKbd tokens={acceleratorTokens(sessionHotkey)} className="ml-0.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('overlay.start_tooltip')}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 gap-1 px-2 text-small font-mono lowercase tracking-tight',
                // Stealth-on (invisible to others) = calm default. Stealth-off
                // (visible to screen-share) = amber warning. We label the
                // STATE itself so the user doesn't have to translate
                // "visible" into "uh-oh, others can see this".
                stealth ? 'text-muted-foreground hover:text-foreground' : 'text-warn'
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
              aria-label={collapseLabel}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={onCollapse}
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{collapseLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Timer + stop control. Owns the elapsed clock so its twice-a-second tick
 * re-renders only this chip, not the overlay tree.
 */
function RecordingChip({
  startedAt,
  busy,
  onStop
}: {
  startedAt: number
  busy: boolean
  onStop: () => void
}) {
  const { t } = useTranslation()
  const elapsed = useElapsed(startedAt)
  const micLost = useCaptureNotices((s) => s.flags.micLost)
  const stopConfirm = useConfirmClick(onStop)
  const stopLabel = stopConfirm.armed
    ? t('overlay.confirm_stop_tooltip')
    : t('overlay.stop_recording_tooltip')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-interactive
          onClick={stopConfirm.click}
          disabled={busy}
          aria-label={stopLabel}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5',
            'border font-mono text-small transition-colors',
            stopConfirm.armed
              ? 'border-signal/60 bg-signal/20 text-signal'
              : micLost
                ? 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/15'
                : 'border-signal/30 bg-signal/10 text-signal hover:border-signal/50 hover:bg-signal/15'
          )}
        >
          {/* Slower pulse (1.6s) — calmer than the default 1s; matches the
              "doesn't want to be seen" stealth posture. A lost mic holds still. */}
          <span
            className={cn(
              'inline-flex size-1.5 rounded-full',
              micLost
                ? 'bg-warn'
                : 'bg-signal motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]'
            )}
          />
          {stopConfirm.armed
            ? t('overlay.confirm_stop')
            : micLost
              ? t('overlay.notices.mic_lost_chip', { elapsed })
              : elapsed}
          <Square className="ml-0.5 size-2.5 fill-current" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{stopLabel}</TooltipContent>
    </Tooltip>
  )
}

function ActionChipsRow({
  busy,
  hasAnswer,
  answerHotkey,
  onWhichQuestion,
  onShorten,
  onCatchUp,
  onFollowUp,
  onAnswer,
  autoAnswer,
  onToggleAutoAnswer,
  modelMenu
}: {
  busy: boolean
  hasAnswer: boolean
  /** Configured answer-last accelerator; null until settings load. */
  answerHotkey: string | null
  onWhichQuestion: () => void
  onShorten: () => void
  onCatchUp: () => void
  onFollowUp: () => void
  onAnswer: () => void
  autoAnswer: boolean
  onToggleAutoAnswer: () => void
  /** Per-request model override, offered from the `more` menu. */
  modelMenu: React.ReactNode
}) {
  const { t } = useTranslation()
  // The row only renders during a session. Shorten / Follow-up operate on an
  // existing answer, so they stay disabled (with a reason) until one exists.
  const answerReason = !hasAnswer ? t('overlay.chips.disabled_needs_answer') : undefined
  // Two visible primaries (Answer + Catch up) and a `more` dropdown for the
  // rest — less eye travel while attention is split with the call.
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-2">
      <ActionChip label={t('overlay.chips.catch_up')} disabled={busy} onClick={onCatchUp} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-interactive
            disabled={busy}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full px-3 text-small transition-colors',
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
          <DropdownMenuItem onSelect={onWhichQuestion}>
            <span className="text-[12px]">{t('overlay.chips.which_question')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasAnswer} onSelect={onShorten} title={answerReason}>
            <span className="text-[12px]">{t('overlay.chips.shorten')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasAnswer} onSelect={onFollowUp} title={answerReason}>
            <span className="text-[12px]">{t('overlay.chips.follow_up')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              onToggleAutoAnswer()
            }}
          >
            <span className="flex-1 text-[12px]">{t('overlay.chips.auto_answer')}</span>
            <span
              className={cn(
                'font-mono text-small lowercase',
                autoAnswer ? 'text-success' : 'text-muted-foreground'
              )}
            >
              {autoAnswer ? t('overlay.on') : t('overlay.off')}
            </span>
          </DropdownMenuItem>
          {modelMenu}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="flex-1" />

      <ActionChip
        label={t('overlay.chips.answer')}
        emphasis
        hotkey={answerHotkey ? compactHotkeyTokens(acceleratorTokens(answerHotkey)) : undefined}
        disabled={busy}
        onClick={onAnswer}
      />
    </div>
  )
}

function ActionChip({
  label,
  emphasis,
  hotkey,
  disabled,
  onClick
}: {
  label: string
  emphasis?: boolean
  /** Accelerator tokens shown as a kbd hint; the trigger key reads brighter than its modifiers. */
  hotkey?: string[]
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      data-interactive
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center rounded-full px-3 text-small transition-colors',
        emphasis
          ? 'bg-foreground text-background hover:bg-foreground/90 font-medium'
          : 'border border-white/10 bg-white/[0.04] text-foreground/85 hover:bg-white/[0.08] hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-40'
      )}
    >
      {label}
      {hotkey && hotkey.length > 0 && (
        <HotkeyKbd tokens={hotkey} className="ml-2 gap-0 bg-background/15" />
      )}
    </button>
  )
}

/** One key cap for a whole chord; modifiers read dimmer than the trigger key. */
function HotkeyKbd({ tokens, className }: { tokens: string[]; className?: string }) {
  return (
    <Kbd className={cn('h-4 gap-1 text-inherit', className)}>
      {tokens.map((tok, i) => (
        <span key={i} className={cn(i < tokens.length - 1 && 'opacity-60')}>
          {tok}
        </span>
      ))}
    </Kbd>
  )
}

interface ModelOverrideProps {
  value: string | null
  onChange: (m: string | null) => void
  /** Currently active LLM provider. Determines which model list to show. */
  provider: LlmProvider
  /** Current default model for `fast` role under `provider`. */
  defaultModel: string
}

function modelLabel(value: string): string {
  return value.includes('/') ? (value.split('/').pop() ?? value) : value
}

function ModelOverrideItems({ value, onChange, provider, defaultModel }: ModelOverrideProps) {
  const { t } = useTranslation()
  const available = useAvailableModels(provider)
  const fastModels = available(provider, PROVIDER_FAST_MODELS[provider] ?? [])
  const visionModels = available(provider, PROVIDER_VISION_MODELS[provider] ?? [])
  return (
    <>
      <DropdownMenuLabel className="text-small font-normal text-muted-foreground">
        {t('overlay.model_picker.override_label', { provider })}
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => onChange(null)}>
        <span className={cn('flex-1 truncate text-[12px]', !value && 'text-foreground')}>
          {t('overlay.model_picker.default')} ·{' '}
          <span className="font-mono text-small text-muted-foreground">{defaultModel}</span>
        </span>
        {!value && <span className="text-small text-success">●</span>}
      </DropdownMenuItem>
      {fastModels.length > 0 && <DropdownMenuSeparator />}
      {fastModels.length > 0 && (
        <DropdownMenuLabel className="text-small font-normal text-muted-foreground">
          {t('overlay.model_picker.text_answers')}
        </DropdownMenuLabel>
      )}
      {fastModels.map((m) => (
        <DropdownMenuItem key={`f-${m}`} onSelect={() => onChange(m)}>
          <span
            className={cn('flex-1 truncate font-mono text-small', value === m && 'text-foreground')}
          >
            {m}
          </span>
          {value === m && <span className="text-small text-success">●</span>}
        </DropdownMenuItem>
      ))}
      {visionModels.length > 0 && <DropdownMenuSeparator />}
      {visionModels.length > 0 && (
        <DropdownMenuLabel className="text-small font-normal text-muted-foreground">
          {t('overlay.model_picker.vision')}
        </DropdownMenuLabel>
      )}
      {visionModels.map((m) => (
        <DropdownMenuItem key={`v-${m}`} onSelect={() => onChange(m)}>
          <span
            className={cn('flex-1 truncate font-mono text-small', value === m && 'text-foreground')}
          >
            {m}
          </span>
          {value === m && <span className="text-small text-success">●</span>}
        </DropdownMenuItem>
      ))}
    </>
  )
}

const MODEL_MENU_CLASS = cn(
  'min-w-[200px] border-white/10 bg-[#111114]/95 backdrop-blur-xl',
  'max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto'
)

function ModelOverrideSubmenu(props: ModelOverrideProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="text-[12px]">{t('overlay.model_picker.menu_label')}</span>
        <span className="ml-auto max-w-[110px] truncate text-small text-muted-foreground">
          {props.value ? modelLabel(props.value) : t('overlay.model_picker.default')}
        </span>
      </DropdownMenuSubTrigger>
      {/* Portaled so the parent menu's overflow can't clip it; marked
          interactive so the click-through detector lets clicks land. */}
      <DropdownMenuPortal>
        <DropdownMenuSubContent data-interactive className={MODEL_MENU_CLASS}>
          <ModelOverrideItems {...props} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

/** Shown in the ask row only while an override is active, so it can be seen and reset. */
function ModelOverridePicker(props: ModelOverrideProps & { value: string }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-interactive
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10',
          'bg-white/[0.04] px-2 py-1 text-small text-muted-foreground',
          'hover:bg-white/[0.08] hover:text-foreground transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20'
        )}
        title={t('overlay.model_picker.tooltip', { provider: props.provider })}
      >
        <span className="max-w-[110px] truncate">{modelLabel(props.value)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Radix renders this in a portal outside our main tree, so the
        // overlay's mouse-region detector can't see it via [data-interactive]
        // on ancestors. Mark it explicitly so clicks on items don't get
        // forwarded through the click-through window.
        data-interactive
        className={MODEL_MENU_CLASS}
      >
        <ModelOverrideItems {...props} />
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
  screenshotHotkey,
  askHotkey
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
  /** Configured focus-ask accelerator; null until settings load. */
  askHotkey: string | null
}) {
  const { t } = useTranslation()
  const snapLabel = screenshotHotkey
    ? t('overlay.input.snap_hotkey_tooltip', {
        chord: acceleratorTokens(screenshotHotkey).join(' + ')
      })
    : t('overlay.input.snap_tooltip')
  const placeholder = image
    ? t('overlay.ask_about_screenshot')
    : askHotkey
      ? t('overlay.ask_placeholder_hotkey', { chord: acceleratorTokens(askHotkey).join('+') })
      : t('overlay.ask_placeholder')
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {image && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-interactive
              onClick={onClearImage}
              className="group relative shrink-0"
              title={t('overlay.input.remove_screenshot')}
            >
              <img
                src={image}
                alt={t('overlay.input.screenshot_alt')}
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
        placeholder={placeholder}
        className={cn(
          'flex-1 resize-none bg-transparent py-1 text-body text-foreground placeholder:text-muted-foreground',
          'border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0'
        )}
      />
      {modelOverride && (
        <ModelOverridePicker
          value={modelOverride}
          onChange={onModelChange}
          provider={activeProvider}
          defaultModel={activeDefaultModel}
        />
      )}
      {!image && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              onClick={onSnap}
              disabled={snapping || busy}
              size="icon"
              variant="ghost"
              aria-label={snapLabel}
              className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            >
              {snapping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Camera className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{snapLabel}</TooltipContent>
        </Tooltip>
      )}
      {streaming ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-interactive
              onClick={onStop}
              size="icon"
              variant="ghost"
              aria-label={t('overlay.stop_generating')}
              className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3 fill-current" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('overlay.stop_generating_tooltip')}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          data-interactive
          onClick={onSend}
          disabled={busy || (!text.trim() && !image)}
          size="icon"
          variant={text.trim() || image ? 'default' : 'ghost'}
          aria-label={t('overlay.send')}
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
  question?: string
}

/**
 * Newest answer first and in full; earlier ones fold to a one-line header.
 * The only overlay component subscribed to the streamed text.
 */
function AnswerHistory({
  maxHeight,
  scrollRef,
  onContinue,
  onContentChange
}: {
  maxHeight: number
  scrollRef: React.RefObject<HTMLDivElement | null>
  onContinue: (id: string) => void
  onContentChange: () => void
}) {
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)

  // The newest answer is at the top, so a fresh ask scrolls back up to it. A
  // continued answer keeps its place: the reader is at its end.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [messages.length, scrollRef])

  useEffect(() => {
    const id = requestAnimationFrame(onContentChange)
    return () => cancelAnimationFrame(id)
  }, [messages.length, latest?.answer.length, onContentChange])

  if (!latest) return null
  const earlier = messages.slice(0, -1).reverse()
  return (
    <AnswerScroller
      ref={scrollRef}
      maxHeight={maxHeight}
      contentKey={`${messages.length}:${latest.answer.length}`}
    >
      <AnswerPane message={latest} onContinue={onContinue} />
      {earlier.length > 0 && (
        <div className="mt-3 flex flex-col gap-0.5 border-t border-white/[0.06] pt-2">
          {earlier.map((m) => (
            <EarlierAnswer key={m.id} message={m} />
          ))}
        </div>
      )}
    </AnswerScroller>
  )
}

export const AnswerPane = memo(function AnswerPane({
  message: m,
  onContinue
}: {
  message: AskMessage
  onContinue: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <div className="sticky top-0 z-10 -mx-1 flex items-start gap-2 bg-[oklch(0.13_0.012_260)] px-1 pb-1 pt-1">
        <div
          title={m.question ?? m.prompt}
          className="line-clamp-2 min-w-0 flex-1 text-small text-muted-foreground"
        >
          {m.question ? t('overlay.question', { question: m.question }) : m.prompt}
        </div>
        {m.status === 'streaming' && (
          <span className="shrink-0 font-mono text-small lowercase text-muted-foreground">
            {t('overlay.streaming')}
          </span>
        )}
        <CopyAnswerButton message={m} />
      </div>
      <AnswerBody message={m} lead />
      {m.status === 'done' && m.finishReason === 'length' && (
        <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-2 py-1 font-mono text-small text-warn">
          <span className="flex-1">{t('overlay.answer_truncated')}</span>
          <button
            data-interactive
            onClick={() => onContinue(m.id)}
            title={t('overlay.continue_tooltip')}
            className="inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 hover:bg-warn/20"
          >
            <ArrowDownToLine className="size-3" />
            {t('overlay.continue')}
          </button>
        </div>
      )}
    </div>
  )
})

const EarlierAnswer = memo(function EarlierAnswer({ message: m }: { message: AskMessage }) {
  const [open, setOpen] = useState(false)
  const preview =
    m.status === 'error'
      ? m.error
      : (m.answer.trimStart().split('\n', 1)[0] ?? '').replace(/[*_`#>]/g, '')
  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          data-interactive
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-small',
            'text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground'
          )}
        >
          <ChevronRight
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <span className="max-w-[40%] shrink-0 truncate text-foreground/80">
            {m.question ?? m.prompt}
          </span>
          <span className="min-w-0 flex-1 truncate">{preview}</span>
        </button>
        {open && <CopyAnswerButton message={m} />}
      </div>
      {open && (
        <div className="pb-2 pl-5 pt-1">
          <AnswerBody message={m} />
        </div>
      )}
    </div>
  )
})

function AnswerBody({ message: m, lead }: { message: AskMessage; lead?: boolean }) {
  const error = <div className="text-xs text-destructive">{m.error}</div>
  if (m.status === 'error' && !m.answer) return error
  const streaming = m.status === 'streaming'
  const split = lead ? splitAnswerLead(m.answer, streaming) : { lead: null, rest: m.answer }
  return (
    <div className={cn('max-w-[65ch]', lead && '[--md-text:14px]')}>
      {split.lead && (
        <p
          data-testid="answer-lead"
          className="mb-2 text-[16px] font-semibold leading-snug text-foreground"
        >
          {split.lead}
        </p>
      )}
      {split.lead === null || split.rest ? (
        <div className={cn(split.lead && '[--md-body-alpha:80%]')}>
          <StreamingMarkdown text={split.rest} streaming={streaming} />
        </div>
      ) : null}
      {m.status === 'error' && error}
    </div>
  )
}

function CopyAnswerButton({ message: m }: { message: AskMessage }) {
  const { t } = useTranslation()
  if (m.status === 'error' || m.answer.length === 0) return null
  return (
    <button
      data-interactive
      onClick={() => void copyToClipboard(m.answer, t('ask_panel.copy_toast'))}
      title={t('overlay.copy_answer')}
      aria-label={t('overlay.copy_answer')}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded',
        'size-5 text-muted-foreground/70 hover:bg-white/10 hover:text-foreground'
      )}
    >
      <Copy className="size-3" />
    </button>
  )
}

/**
 * Two-step trigger for destructive controls: the first click arms it for
 * `windowMs`, a second click inside that window runs the action.
 */
function useConfirmClick(action: () => void, windowMs = 3000): { armed: boolean; click(): void } {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  function click(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (armed) {
      setArmed(false)
      action()
      return
    }
    setArmed(true)
    timerRef.current = setTimeout(() => setArmed(false), windowMs)
  }

  return { armed, click }
}

function useElapsed(startedAt: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const s = Math.floor((now - startedAt) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
