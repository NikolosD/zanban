import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Trash2, Square, ArrowDownToLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { useAi, wireAiIpc } from '@renderer/features/ai/store'
import { useAskRequest } from '@renderer/features/ai/useAskRequest'
import { Toaster } from '@renderer/components/ui/sonner'
import { ZanbanMark } from '@renderer/components/brand'
import { useStickToBottom } from '@renderer/lib/useStickToBottom'

/**
 * Standalone chat window — talks to the AI without any meeting / transcript
 * context. Useful for "explain this", "help me phrase that", etc., outside
 * of a live call. Persona settings still apply.
 */
export function ChatApp() {
  const { t } = useTranslation()
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)
  const [input, setInput] = useState('')
  const { run, stop, busy } = useAskRequest()
  const streaming = latest?.status === 'streaming'
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Follows the streaming answer only while the user is at the bottom, so
  // scrolling up to re-read mid-stream isn't yanked back on every chunk.
  const { rootRef: scrollRef } = useStickToBottom<HTMLDivElement>(latest?.id, latest?.answer.length)

  useEffect(() => {
    const off = wireAiIpc()
    return () => off()
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    await run({ prompt: text })
    inputRef.current?.focus()
  }

  function continueAnswer(id: string) {
    void run({ prompt: 'continue', continueFrom: id })
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header
        className="flex h-9 items-center justify-between gap-2 border-b border-white/[0.06] px-3 text-[11px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <ZanbanMark size={13} fg="oklch(0.66 0.01 260)" />
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('chat.title')}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => {
            if (busy || streaming) stop()
            useAi.getState().reset()
          }}
        >
          <Trash2 className="size-3" /> {t('chat.clear')}
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-12 text-center text-[12px] text-muted-foreground">
            {t('chat.empty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-5">
            {messages.map((m, i) => (
              <li key={m.id} className="flex flex-col gap-2">
                <div className="rounded-md bg-white/[0.04] px-3 py-2 text-[13px]">{m.prompt}</div>
                <div className="px-1 text-[13px]">
                  <StreamingMarkdown text={m.answer} />
                  {m.status === 'streaming' && (
                    <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  )}
                  {m.status === 'error' && <span className="text-red-400">{m.error}</span>}
                </div>
                {m.status === 'done' && (
                  <FinishNotice
                    finishReason={m.finishReason}
                    answer={m.answer}
                    onContinue={
                      i === messages.length - 1 && !busy ? () => continueAnswer(m.id) : undefined
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-white/[0.06] p-3">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={t('chat.placeholder')}
          className="flex-1 resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-white/30"
        />
        {streaming ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={() => stop()}
            title={t('chat.stop_generating')}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label={t('overlay.send')}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        )}
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

const CONTENT_FILTER_REASONS = new Set(['content', 'content-filter'])

/**
 * Why a finished answer stopped short: truncated at the token cap (offers
 * Continue on the latest answer), blocked by the provider's content filter, or
 * empty. A user Stop also finishes as 'stop' and needs no notice.
 */
function FinishNotice({
  finishReason,
  answer,
  onContinue
}: {
  finishReason?: string
  answer: string
  onContinue?: () => void
}) {
  const { t } = useTranslation()
  if (finishReason === 'length') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
        <span className="flex-1">{t('overlay.answer_truncated')}</span>
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            title={t('overlay.continue_tooltip')}
            className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 hover:bg-amber-500/20"
          >
            <ArrowDownToLine className="size-3" aria-hidden />
            {t('overlay.continue')}
          </button>
        )}
      </div>
    )
  }
  const notice =
    finishReason && CONTENT_FILTER_REASONS.has(finishReason)
      ? t('chat.content_filtered')
      : !answer.trim() && finishReason !== 'stop'
        ? t('chat.empty_answer')
        : null
  if (!notice) return null
  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200"
    >
      {notice}
    </div>
  )
}
