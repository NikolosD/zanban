import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Send,
  AlertTriangle,
  EyeOff,
  Eye,
  Square,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  ChevronDown
} from 'lucide-react'
import { wireTranscriptIpc, useTranscript } from '@renderer/features/transcript/store'
import { useQuestions } from '@renderer/features/transcript/questionsStore'
import { wireAiIpc, useAi } from '@renderer/features/ai/store'
import { wireJobsIpc } from '@renderer/features/jobs/jobsStore'
import { JobsBadge } from '@renderer/features/jobs/JobsBadge'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { useSettingsStore, wireSettingsIpc } from '@renderer/features/settings/store'
import {
  ANSWER_LAST_PROMPT,
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_FAST_MODELS,
  PROVIDER_VISION_MODELS,
  SCREENSHOT_DEFAULT_PROMPT,
  type AppSettings
} from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import { Toaster } from '@renderer/components/ui/sonner'
import { cn } from '@renderer/lib/utils'
import { stopCaptures, wireCaptureAutostop } from '@renderer/audio/captureController'

const FOLLOW_UP_PROMPT =
  'Based on the previous answer, suggest 2-3 sharp follow-up questions I should ask. Output as a short bullet list, no preamble.'
const RECAP_PROMPT =
  'Recap what was discussed in the last 90 seconds of this meeting. 3-5 short bullets. No preamble.'
const WHAT_TO_ANSWER_PROMPT =
  'Based on what was just said in this meeting, what is the single most important question I should answer right now? State the question in one short line, no preamble.'
const SHORTEN_PROMPT =
  'Take the previous answer and rewrite it 2-3x shorter without losing key information. No preamble.'

export function OverlayApp() {
  const [stealth, setStealth] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const session = useTranscript((s) => s.session)
  const t0 = session.kind === 'running' ? session.startedAt : null
  const elapsed = useElapsed(session.kind === 'running', t0)
  const settings = useSettingsStore((s) => s.settings)
  const refreshSettings = useSettingsStore((s) => s.refresh)
  const status = useTranscript((s) => s.status)
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)
  const allQuestions = useQuestions((s) => s.questions)
  const pendingQuestions = useMemo(
    () => allQuestions.filter((q) => q.status === 'pending').slice(-2),
    [allQuestions]
  )

  const transcriptionError =
    status.mic?.kind === 'error'
      ? status.mic.message
      : status.system?.kind === 'error'
        ? status.system.message
        : null

  const apiKeysMissing =
    !!settings && (!settings.googleProjectId || !settings.vercelApiKey)

  useEffect(() => {
    void window.zanban.overlay.getStealth().then(setStealth)
    void useSettingsStore.getState().load()
    const offTr = wireTranscriptIpc()
    const offAi = wireAiIpc()
    const offCap = wireCaptureAutostop()
    const offJobs = wireJobsIpc()
    // Live-sync settings from main — needed so toggles changed in the
    // dashboard (e.g. hideWidgetWhenHidden, autoDetectQuestions) take effect
    // here without an app restart.
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
      window.zanban.overlay.setIgnoreMouse(!overInteractive)
    }
    window.addEventListener('mousemove', onMove)

    const offAsk = window.zanban.overlay.onFocusAsk(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    const offAnswerLast = window.zanban.overlay.onAnswerLast(() => {
      void runPrompt(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
    })

    const offSnapshot = window.zanban.overlay.onSnapshotAsk((snap) => {
      setImage(snap.dataUrl)
      setOcrText(snap.ocrText)
      inputRef.current?.focus()
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
      offStealth()
      offSettings()
      window.removeEventListener('mousemove', onMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function stopSession(): Promise<void> {
    setBusy(true)
    try {
      stopCaptures()
      await window.zanban.session.stop()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Wait briefly for STT to flush the latest partial. If the transcript was
   * updated within `quietMs` of now, poll until either: it has been quiet for
   * `quietMs`, OR the cap (`maxWaitMs`) elapses. Returns immediately if the
   * transcript is already settled.
   */
  async function awaitTranscriptSettle(maxWaitMs = 2500, quietMs = 600): Promise<void> {
    const start = Date.now()
    if (useTranscript.getState().session.kind !== 'running') return
    while (Date.now() - start < maxWaitMs) {
      const last = useTranscript.getState().lastUpdateAt
      if (!last || Date.now() - last >= quietMs) return
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  async function runPrompt(
    prompt: string,
    label?: string,
    imageDataUrl?: string,
    waitForTranscript?: boolean,
    ocr?: string | null
  ): Promise<void> {
    const p = prompt.trim()
    if ((!p && !imageDataUrl) || busy) return
    setBusy(true)
    try {
      if (waitForTranscript) await awaitTranscriptSettle()
      const { requestId } = await window.zanban.ai.ask({
        prompt: p || SCREENSHOT_DEFAULT_PROMPT,
        ...(imageDataUrl ? { imageDataUrl } : {}),
        ...(ocr ? { ocrText: ocr } : {}),
        ...(modelOverride ? { modelOverride } : {})
      })
      useAi.getState().newRequest(label ?? p, requestId)
    } catch (err) {
      const id = `err-${Date.now()}`
      useAi.getState().newRequest(label ?? p, id)
      useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function send(): Promise<void> {
    const value = text.trim()
    const attached = image
    const ocrAttached = ocrText
    if (!value && !attached) return
    setText('')
    setImage(null)
    setOcrText(null)
    await runPrompt(value, undefined, attached ?? undefined, false, ocrAttached)
  }

  async function snap(): Promise<void> {
    if (snapping) return
    setSnapping(true)
    try {
      const snap = await window.zanban.screenshot.captureWithOcr()
      if (snap) {
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
  const hasContent = hasAnswer || apiKeysMissing || transcriptionError ||
    (pendingQuestions.length > 0 && settings?.autoDetectQuestions !== false)
  // Hide-widget-when-hidden only collapses the action chips row now — the
  // input pill and answer pane stay so the user can still type / read a
  // streaming answer while Hide is on. Previously this also dropped the
  // input and content panel, which made the overlay unusable in its main
  // mode (you'd toggle Hide and lose access to your own Q&A).
  const chipsCollapsed = stealth && settings?.hideWidgetWhenHidden === true

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="pointer-events-none p-3"
        style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}
      >
        <div
          data-interactive
          className={cn(
            // Tighter gap between surfaces so the StatusBar / Action chips /
            // Input read as one composed object rather than three independent
            // pills floating on the desktop. Per DESIGN.md "fewer surfaces".
            'pointer-events-auto mx-auto flex w-full flex-col gap-1.5',
            'max-w-[680px]'
          )}
        >
          <StatusBar
            running={running}
            busy={busy}
            elapsed={elapsed}
            stealth={stealth}
            onStop={() => void stopSession()}
            onToggleStealth={() => void toggleStealth()}
            onClose={() => void backToDashboard()}
          />

          {!chipsCollapsed && (
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
              onAnswer={() =>
                void runPrompt(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
              }
            />
          )}

          <InputPill
            text={text}
            image={image}
            busy={busy}
            snapping={snapping}
            inputRef={inputRef}
            onTextChange={setText}
            onKey={onKey}
            onSend={() => void send()}
            onSnap={() => void snap()}
            onClearImage={() => {
              setImage(null)
              setOcrText(null)
            }}
            modelOverride={modelOverride}
            onModelChange={setModelOverride}
            activeProvider={settings?.llmProvider ?? 'vercel-gateway'}
            activeDefaultModel={
              settings?.aiModels?.[settings.llmProvider]?.fast ||
              (settings ? PROVIDER_MODEL_DEFAULTS[settings.llmProvider].fast : '')
            }
          />

          {/* Answer / alerts / detected-questions panel. Always rendered when
              there is something to show — Hide should never dismiss what the
              user just asked for. */}
          {hasContent && (
            <div
              className={cn(
                'flex flex-col gap-2 rounded-2xl border border-white/10',
                'bg-black/55 px-3 py-2 backdrop-blur-2xl backdrop-saturate-150 text-foreground',
                'shadow-2xl'
              )}
            >
              {(apiKeysMissing || transcriptionError) && (
                <div className="space-y-2">
                  {apiKeysMissing && (
                    <Alert
                      variant="default"
                      className="bg-amber-500/10 border-amber-500/30 text-amber-200"
                    >
                      <AlertTriangle className="size-4 text-amber-400" />
                      <AlertTitle>API keys not configured</AlertTitle>
                      <AlertDescription>
                        Open the dashboard → Settings. Need a Google Cloud project ID
                        (STT — auth via gcloud or pasted JSON) and a Vercel AI Gateway
                        key (LLM).{' '}
                        <button
                          className="underline underline-offset-2"
                          onClick={() => void refreshSettings()}
                        >
                          re-check
                        </button>
                      </AlertDescription>
                    </Alert>
                  )}
                  {transcriptionError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>Transcription error</AlertTitle>
                      <AlertDescription>{transcriptionError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {pendingQuestions.length > 0 && settings?.autoDetectQuestions !== false && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingQuestions.map((q) => (
                    <button
                      key={q.id}
                      data-interactive
                      onClick={() => {
                        useQuestions.getState().markAnswered(q.id)
                        void runPrompt(q.text)
                      }}
                      className={cn(
                        'group inline-flex max-w-[420px] items-center gap-1.5 rounded-md',
                        'border border-primary/40 bg-primary/10 px-2 py-1',
                        'text-[11px] text-foreground transition-colors',
                        'hover:bg-primary/20 hover:border-primary/60'
                      )}
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="truncate">{q.text}</span>
                      <span className="ml-1 shrink-0 rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-primary">
                        answer ↵
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {latest && (
                <div className="max-h-[360px] overflow-y-auto px-1 py-1">
                  <AnswerPane message={latest} />
                </div>
              )}
            </div>
          )}

          {/* Footer was a separate surface showing the active model. The
              same info is already reachable via the model picker in the
              input pill — keeping a fifth surface just for a label was
              fragmentation. Removed; the picker is the source of truth. */}
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
  onClose
}: {
  running: boolean
  busy: boolean
  elapsed: string
  stealth: boolean
  onStop: () => void
  onToggleStealth: () => void
  onClose: () => void
}) {
  return (
    <div
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border border-white/10',
        'bg-black/55 px-2 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
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
            <TooltipContent>Click to stop recording</TooltipContent>
          </Tooltip>
        ) : (
          <span
            data-interactive
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 font-mono text-[10px] text-muted-foreground"
          >
            <span className="inline-flex size-1.5 rounded-full bg-muted-foreground/40" />
            idle
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
                // Stealth on = quiet, default fg. Stealth off = warning amber.
                // We don't dual-signal both states — only the off (visible)
                // state gets a color cue; the on (hidden) state is the calm
                // default and shouldn't compete with the recording chip.
                stealth ? 'text-muted-foreground hover:text-foreground' : 'text-amber-300'
              )}
              onClick={onToggleStealth}
            >
              {stealth ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              <span>{stealth ? 'hidden' : 'visible'}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {stealth
              ? 'Hidden in screen-share. Click to make visible.'
              : 'Visible in screen-share. Click to hide.'}
          </TooltipContent>
        </Tooltip>

        {/* Hotkey hint slot. Two-tone monospace per DESIGN.md — modifier
            keys at lower contrast than the trigger. Lives between Hide and
            Close so the pill reads: status · hide · ⌥hint · ✕ */}
        <span className="hidden items-center gap-1 px-1 font-mono text-[10px] tabular-nums sm:inline-flex">
          <span className="text-muted-foreground/55">⌃⇧</span>
          <span className="text-muted-foreground">␣</span>
          <span className="text-muted-foreground/40">ask</span>
        </span>

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
          <TooltipContent>Back to dashboard</TooltipContent>
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
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-1.5 rounded-2xl',
        'border border-white/10 bg-black/55 px-2 py-1.5',
        'backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <ActionChip label="What to answer?" disabled={busy || !running} onClick={onWhatToAnswer} />
      <ActionChip label="Shorten" disabled={busy || !hasAnswer} onClick={onShorten} />
      <ActionChip label="Recap" disabled={busy || !running} onClick={onRecap} />
      <ActionChip label="Follow Up Question" disabled={busy || !hasAnswer} onClick={onFollowUp} />
      <ActionChip label="Answer" emphasis disabled={busy} onClick={onAnswer} />
    </div>
  )
}

function ActionChip({
  label,
  emphasis,
  disabled,
  onClick
}: {
  label: string
  emphasis?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      data-interactive
      onClick={onClick}
      disabled={disabled}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'inline-flex h-7 items-center rounded-full px-3 text-[11px] transition-colors',
        emphasis
          ? 'bg-foreground/90 text-background hover:bg-foreground'
          : 'border border-white/10 bg-white/[0.04] text-foreground/85 hover:bg-white/[0.08] hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-40'
      )}
    >
      {emphasis && <Sparkles className="mr-1 size-3" />}
      {label}
    </button>
  )
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
  provider: AppSettings['llmProvider']
  /** Current default model for `fast` role under `provider` — shown in trigger. */
  defaultModel: string
  noDrag: React.CSSProperties
}) {
  const fastModels = PROVIDER_FAST_MODELS[provider] ?? []
  const visionModels = PROVIDER_VISION_MODELS[provider] ?? []

  const label = value
    ? value.includes('/')
      ? value.split('/').pop() ?? value
      : value
    : 'Default'

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
        title={`Override model for this request · provider: ${provider}`}
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
          Override · {provider}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className={cn('flex-1 truncate text-[12px]', !value && 'text-foreground')}>
            Default · <span className="font-mono text-[10px] text-muted-foreground">{defaultModel}</span>
          </span>
          {!value && <span className="text-[10px] text-emerald-400">●</span>}
        </DropdownMenuItem>
        {fastModels.length > 0 && <DropdownMenuSeparator />}
        {fastModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            Text answers
          </DropdownMenuLabel>
        )}
        {fastModels.map((m) => (
          <DropdownMenuItem key={`f-${m}`} onSelect={() => onChange(m)}>
            <span className={cn('flex-1 truncate font-mono text-[11px]', value === m && 'text-foreground')}>
              {m}
            </span>
            {value === m && <span className="text-[10px] text-emerald-400">●</span>}
          </DropdownMenuItem>
        ))}
        {visionModels.length > 0 && <DropdownMenuSeparator />}
        {visionModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            Vision (screenshots)
          </DropdownMenuLabel>
        )}
        {visionModels.map((m) => (
          <DropdownMenuItem key={`v-${m}`} onSelect={() => onChange(m)}>
            <span className={cn('flex-1 truncate font-mono text-[11px]', value === m && 'text-foreground')}>
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
  snapping,
  inputRef,
  onTextChange,
  onKey,
  onSend,
  onSnap,
  onClearImage,
  modelOverride,
  onModelChange,
  activeProvider,
  activeDefaultModel
}: {
  text: string
  image: string | null
  busy: boolean
  snapping: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onTextChange: (v: string) => void
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onSnap: () => void
  onClearImage: () => void
  modelOverride: string | null
  onModelChange: (m: string | null) => void
  activeProvider: AppSettings['llmProvider']
  activeDefaultModel: string
}) {
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-2xl border border-white/10',
        'bg-black/55 px-3 py-2 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
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
              title="Remove screenshot"
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
          <TooltipContent>Screenshot attached · click to remove</TooltipContent>
        </Tooltip>
      )}
      <textarea
        data-interactive
        ref={inputRef}
        rows={1}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKey}
        placeholder={
          image
            ? 'Ask about the screenshot…'
            : 'Ask anything on screen or conversation, or'
        }
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
              ) : (
                <>
                  <Kbd>⌘</Kbd>
                  <span>+</span>
                  <Kbd>H</Kbd>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>Snap a screenshot to send with your question</TooltipContent>
        </Tooltip>
      )}
      <Button
        data-interactive
        onClick={onSend}
        disabled={busy || (!text.trim() && !image)}
        size="icon"
        variant={text.trim() || image ? 'default' : 'ghost'}
        style={noDrag}
        className="size-7 shrink-0 rounded-full"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
      </Button>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded bg-white/10 px-1 font-mono text-[9px] leading-none text-foreground/80">
      {children}
    </span>
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

function AnswerPane({ message: m }: { message: AskMessage }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
        {m.prompt}
      </div>
      {m.status === 'error' ? (
        <div className="text-xs text-destructive">{m.error}</div>
      ) : (
        <StreamingMarkdown text={m.answer} />
      )}
      {m.status === 'streaming' && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          streaming…
        </div>
      )}
      {m.status === 'done' && m.finishReason === 'length' && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
          answer truncated — hit max output tokens. type "continue" to resume.
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
