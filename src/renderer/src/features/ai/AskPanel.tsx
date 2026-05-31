import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Send,
  Quote,
  Loader2,
  Wand2,
  Image as ImageIcon,
  X,
  Copy,
  ArrowDownToLine,
  Square,
  RefreshCw,
  ChevronDown,
  FileText,
  History,
  ListChecks
} from 'lucide-react'
import { useAi } from './store'
import { useAskRequest } from './useAskRequest'
import { ModelReaskMenu } from './ModelReaskMenu'
import { StreamingMarkdown } from './StreamingMarkdown'
import { useSettingsStore } from '@renderer/features/settings/store'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Card, CardContent } from '@renderer/components/ui/card'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'
import type { AiSource, LlmProvider } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { useStickToBottom } from '@renderer/lib/useStickToBottom'

export function AskPanel({
  autoFocusKey = 0,
  className
}: {
  autoFocusKey?: number
  className?: string
}) {
  const { t } = useTranslation()
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [snapping, setSnapping] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const { run, stop, busy } = useAskRequest()
  const streaming = latest?.status === 'streaming'
  const settings = useSettingsStore((s) => s.settings)
  // Remember the last prompt+context so Regenerate / model re-ask can repeat it.
  const lastReqRef = useRef<{
    prompt: string
    label?: string
    image: string | null
    ocr: string | null
  } | null>(null)
  // Tracks the in-flight instant snapshot so a late OCR result folds into the
  // current attachment, not a stale one (F1/F5 — same path as the overlay).
  const snapshotIdRef = useRef<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [autoFocusKey])

  // Background OCR for an instant snapshot landed — fold it in if the
  // attachment is still the one we captured.
  useEffect(() => {
    return window.zanban.screenshot.onOcr((result) => {
      if (result.snapshotId === snapshotIdRef.current) setOcrText(result.ocrText)
    })
  }, [])

  // Keep the latest answer visible while it streams. Radix ScrollArea
  // scrolls a descendant viewport, not the root, so we resolve it.
  const { rootRef: scrollRef } = useStickToBottom<HTMLDivElement>(
    latest?.id,
    latest?.answer.length,
    (root) => root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
  )

  async function send(prompt?: string) {
    const p = (prompt ?? text).trim()
    const attached = image
    const ocrAttached = ocrText
    if (!p && !attached) return
    if (busy) return
    if (!prompt) setText('')
    setImage(null)
    setOcrText(null)
    snapshotIdRef.current = null
    lastReqRef.current = { prompt: p, image: attached, ocr: ocrAttached }
    await run({ prompt: p, image: attached, ocr: ocrAttached, modelOverride })
  }

  async function answerLast() {
    if (busy) return
    lastReqRef.current = {
      prompt: ANSWER_LAST_PROMPT,
      label: 'Answer last question',
      image: null,
      ocr: null
    }
    await run({
      prompt: ANSWER_LAST_PROMPT,
      label: 'Answer last question',
      waitForTranscript: true,
      modelOverride
    })
  }

  // Regenerate / re-ask the last prompt, optionally with a different model.
  async function regenerate(modelId?: string | null) {
    const last = lastReqRef.current
    if (!last || busy) return
    await run({
      prompt: last.prompt,
      label: last.label,
      image: last.image,
      ocr: last.ocr,
      modelOverride: modelId ?? modelOverride
    })
  }

  async function snap() {
    if (snapping) return
    setSnapping(true)
    try {
      // F5: same OCR-capable instant path as the overlay — image attaches at
      // once, OCR text folds in via the onOcr subscription. Previously this
      // used screenshot.capture() (no OCR), so the model got only the image.
      const snap = await window.zanban.screenshot.captureInstant()
      if (snap) {
        snapshotIdRef.current = snap.snapshotId
        setImage(snap.dataUrl)
        setOcrText(snap.ocrText)
      }
    } finally {
      setSnapping(false)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className={cn('flex flex-col gap-2 min-h-0', className)}>
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        {messages.length === 0 ? (
          <Empty onSend={send} onAnswerLast={answerLast} />
        ) : (
          <div className="flex flex-col gap-3 pr-2">
            {messages.map((m, i) => {
              const isLatest = i === messages.length - 1
              return (
                <AskCard
                  key={m.id}
                  message={m}
                  onContinue={() => void send('continue')}
                  // Regenerate/model re-ask/follow-ups only on the latest card.
                  onRegenerate={isLatest ? () => void regenerate() : undefined}
                  onReaskModel={isLatest ? (model) => void regenerate(model) : undefined}
                  onAskFollowUp={isLatest ? (q) => void send(q) : undefined}
                  provider={settings?.llmProvider ?? 'vercel-gateway'}
                  busy={busy}
                />
              )
            })}
          </div>
        )}
      </ScrollArea>
      <div className="flex flex-col gap-1.5 shrink-0">
        {image && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-1.5">
            <img
              src={image}
              alt="screenshot"
              className="h-12 w-auto rounded border border-border/50 object-cover"
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {t('ask_panel.screenshot_attached')}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6"
              onClick={() => {
                setImage(null)
                setOcrText(null)
                snapshotIdRef.current = null
              }}
              title={t('ask_panel.remove_screenshot')}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-md border bg-input/30 p-1">
          <Textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              image ? t('ask_panel.ask_about_screenshot_short') : t('ask_panel.ask_placeholder')
            }
            className="min-h-[28px] max-h-20 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            onClick={() => void snap()}
            disabled={snapping || busy}
            size="icon"
            variant="ghost"
            title={t('ask_panel.attach_screenshot_tooltip')}
            className="size-8 shrink-0"
          >
            {snapping ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImageIcon className="size-3.5" />
            )}
          </Button>
          <Button
            onClick={() => void answerLast()}
            disabled={busy}
            size="icon"
            variant="ghost"
            title={t('ask_panel.answer_last_tooltip')}
            className="size-8 shrink-0"
          >
            <Wand2 className="size-3.5" />
          </Button>
          <ModelReaskMenu
            value={modelOverride}
            onChange={setModelOverride}
            provider={settings?.llmProvider ?? 'vercel-gateway'}
            triggerClassName="h-8 shrink-0"
          />
          {streaming ? (
            <Button
              onClick={() => stop()}
              size="icon"
              variant="destructive"
              title={t('ask_panel.stop_tooltip')}
              className="size-8 shrink-0"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={() => void send()}
              disabled={busy || (!text.trim() && !image)}
              size="icon"
              variant={text.trim() || image ? 'default' : 'ghost'}
              className="size-8 shrink-0"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Empty({
  onSend,
  onAnswerLast
}: {
  onSend: (prompt: string) => void
  onAnswerLast: () => void
}) {
  const { t } = useTranslation()
  const suggestions = [
    { label: t('ask_panel.answer_last_question'), action: onAnswerLast, primary: true },
    {
      label: t('ask_panel.summarize_last_60s'),
      // Prompt sent to the LLM stays English so prompt engineering keeps
      // working regardless of UI language; the user-visible label is i18n'd.
      action: () => onSend('Summarize the last 60 seconds')
    },
    { label: t('ask_panel.what_to_say_next'), action: () => onSend('What should I say next?') }
  ]
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('ask_panel.quick_actions')}
      </div>
      {suggestions.map((s) => (
        <button
          key={s.label}
          onClick={s.action}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
            s.primary
              ? 'bg-primary/10 border border-primary/40 text-foreground hover:bg-primary/20'
              : 'border bg-card/40 hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {s.label}
        </button>
      ))}
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
  sources?: AiSource[]
}

export function AskCard({
  message: m,
  onContinue,
  onRegenerate,
  onReaskModel,
  onAskFollowUp,
  provider,
  busy
}: {
  message: AskMessage
  onContinue?: () => void
  /** Repeat the last prompt with the current model. Latest card only. */
  onRegenerate?: () => void
  /** Repeat the last prompt with a different model. Latest card only. */
  onReaskModel?: (model: string) => void
  /** Ask one of the suggested follow-up questions. Latest card only. */
  onAskFollowUp?: (question: string) => void
  provider?: LlmProvider
  busy?: boolean
}) {
  const { t } = useTranslation()
  const canCopy = m.status !== 'error' && m.answer.length > 0
  // Show regenerate/re-ask only on a finished (non-streaming) latest card.
  const showActions = m.status !== 'streaming' && (onRegenerate || onReaskModel)
  return (
    <Card
      className={cn(
        'transition-all border-0 bg-transparent shadow-none',
        m.status === 'streaming' && 'ring-1 ring-primary/40'
      )}
    >
      <CardContent className="px-1 py-1">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Quote className="size-3 shrink-0" />
          <span className="flex-1 truncate">{m.prompt}</span>
          {canCopy && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => void copyToClipboard(m.answer, t('ask_panel.copy_toast'))}
              title={t('ask_panel.copy_answer')}
            >
              <Copy className="size-3" />
            </Button>
          )}
        </div>
        {m.status === 'error' ? (
          <div className="text-xs text-destructive">{m.error}</div>
        ) : (
          <StreamingMarkdown text={m.answer} />
        )}
        {m.status === 'streaming' && (
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className={cn('size-1.5 rounded-full bg-primary animate-pulse')} />
            {t('ask_panel.streaming')}
          </div>
        )}
        {m.status === 'done' && m.finishReason === 'length' && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
            <span className="flex-1">{t('ask_panel.answer_truncated')}</span>
            {onContinue && (
              <button
                onClick={onContinue}
                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 hover:bg-amber-500/20"
                title={t('ask_panel.continue_tooltip')}
              >
                <ArrowDownToLine className="size-3" />
                {t('ask_panel.continue')}
              </button>
            )}
          </div>
        )}
        {showActions && (
          <div className="mt-2 flex items-center gap-1.5">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={busy}
                title={t('ask_panel.regenerate_tooltip')}
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-card/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className="size-3" />
                {t('ask_panel.regenerate')}
              </button>
            )}
            {onReaskModel && provider && (
              <ModelReaskMenu
                value={null}
                onChange={() => {}}
                onReask={onReaskModel}
                provider={provider}
                align="start"
                triggerClassName="h-6 py-0.5"
              />
            )}
          </div>
        )}
        {m.status === 'done' && onAskFollowUp && m.answer.length > 0 && (
          <FollowUpChips
            question={m.prompt}
            answer={m.answer}
            onAsk={onAskFollowUp}
            disabled={busy}
          />
        )}
        {m.status !== 'error' && m.sources && m.sources.length > 0 && (
          <SourcesList sources={m.sources} />
        )}
      </CardContent>
    </Card>
  )
}

/** Icon + accent per source kind. */
function sourceMeta(kind: AiSource['kind']) {
  if (kind === 'doc') return { Icon: FileText, color: 'text-sky-300' }
  if (kind === 'recap') return { Icon: ListChecks, color: 'text-violet-300' }
  return { Icon: History, color: 'text-emerald-300' }
}

/**
 * Collapsible "Sources" list shown under an answer: the RAG fragments that were
 * retrieved (transcript history, reference docs, recaps) with their similarity
 * distance and a short snippet. Collapsed by default to keep answers tight.
 */
function SourcesList({ sources }: { sources: AiSource[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 border-t border-border/40 pt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
      >
        <ChevronDown className={cn('size-3 transition-transform', !open && '-rotate-90')} />
        {t('ask_panel.sources', { count: sources.length })}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {sources.map((s) => {
            const { Icon, color } = sourceMeta(s.kind)
            return (
              <li
                key={s.id}
                className="rounded-md border border-border/50 bg-card/40 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <Icon className={cn('size-3 shrink-0', color)} />
                  <span className="truncate font-medium text-foreground/85">{s.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                    {s.distance.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-muted-foreground">{s.snippet}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Clickable follow-up question chips shown under a completed answer. Fetches up
 * to 3 short suggestions from the helper LLM once, on mount. Renders nothing
 * while loading or when the LLM returns none — so a flaky/disabled helper just
 * means no chips, never an error.
 */
function FollowUpChips({
  question,
  answer,
  onAsk,
  disabled
}: {
  question: string
  answer: string
  onAsk: (q: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [chips, setChips] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void window.zanban.ai
      .followUps(question, answer)
      .then((qs) => {
        if (!cancelled) setChips(qs)
      })
      .catch(() => {
        /* helper LLM unavailable — just show no chips */
      })
    return () => {
      cancelled = true
    }
    // Suggestions depend on the finished answer; refetch only if it changes.
  }, [question, answer])

  if (chips.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {t('ask_panel.follow_ups')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((q) => (
          <button
            key={q}
            onClick={() => onAsk(q)}
            disabled={disabled}
            className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-left text-[11px] text-foreground/85 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
