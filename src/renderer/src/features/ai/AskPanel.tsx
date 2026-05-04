import { useEffect, useRef, useState } from 'react'
import { Send, Quote, Loader2, Wand2, Image as ImageIcon, X } from 'lucide-react'
import { useAi } from './store'
import { StreamingMarkdown } from './StreamingMarkdown'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { Card, CardContent } from '@renderer/components/ui/card'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { ANSWER_LAST_PROMPT, SCREENSHOT_DEFAULT_PROMPT } from '@shared/types'
import { cn } from '@renderer/lib/utils'

export function AskPanel({
  autoFocusKey = 0,
  className
}: {
  autoFocusKey?: number
  className?: string
}) {
  const messages = useAi((s) => s.messages)
  const latest = messages.at(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [autoFocusKey])

  // When a fresh ask starts, jump to top so the new answer's beginning is visible.
  useEffect(() => {
    if (!latest) return
    const root = scrollRef.current
    if (!root) return
    const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
    const target = viewport ?? root
    target.scrollTop = 0
  }, [latest?.id])

  async function send(prompt?: string) {
    const p = (prompt ?? text).trim()
    const attached = image
    if (!p && !attached) return
    if (busy) return
    setBusy(true)
    if (!prompt) setText('')
    setImage(null)
    try {
      const askPrompt = p || SCREENSHOT_DEFAULT_PROMPT
      const { requestId } = await window.zanban.ai.ask({
        prompt: askPrompt,
        ...(attached ? { imageDataUrl: attached } : {})
      })
      useAi.getState().newRequest(askPrompt, requestId)
    } catch (err) {
      const id = `err-${Date.now()}`
      useAi.getState().newRequest(p, id)
      useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function answerLast() {
    if (busy) return
    setBusy(true)
    try {
      const { requestId } = await window.zanban.ai.ask({ prompt: ANSWER_LAST_PROMPT })
      useAi.getState().newRequest('Answer last question', requestId)
    } catch (err) {
      const id = `err-${Date.now()}`
      useAi.getState().newRequest('Answer last question', id)
      useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function snap() {
    if (snapping) return
    setSnapping(true)
    try {
      const dataUrl = await window.zanban.screenshot.capture()
      if (dataUrl) setImage(dataUrl)
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
        {latest ? (
          <div className="pr-2">
            <AskCard message={latest} />
          </div>
        ) : (
          <Empty onSend={send} onAnswerLast={answerLast} />
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
              screenshot attached · vision model will be used
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6"
              onClick={() => setImage(null)}
              title="Remove screenshot"
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
            placeholder={image ? 'Ask about this screenshot…' : 'Ask anything about the call…'}
            className="min-h-[28px] max-h-20 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            onClick={() => void snap()}
            disabled={snapping || busy}
            size="icon"
            variant="ghost"
            title="Attach a screenshot of the primary display"
            className="size-8 shrink-0"
          >
            {snapping ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
          </Button>
          <Button
            onClick={() => void answerLast()}
            disabled={busy}
            size="icon"
            variant="ghost"
            title="Answer the last question (Ctrl+Shift+Enter)"
            className="size-8 shrink-0"
          >
            <Wand2 className="size-3.5" />
          </Button>
          <Button
            onClick={() => void send()}
            disabled={busy || (!text.trim() && !image)}
            size="icon"
            variant={text.trim() || image ? 'default' : 'ghost'}
            className="size-8 shrink-0"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
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
  const suggestions = [
    { label: 'Answer last question (Ctrl+Shift+Enter)', action: onAnswerLast, primary: true },
    { label: 'Summarize the last 60 seconds', action: () => onSend('Summarize the last 60 seconds') },
    { label: 'What should I say next?', action: () => onSend('What should I say next?') }
  ]
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Quick actions
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
}

export function AskCard({ message: m }: { message: AskMessage }) {
  return (
    <Card
      className={cn(
        'transition-all border-0 bg-transparent shadow-none',
        m.status === 'streaming' && 'ring-1 ring-primary/40'
      )}
    >
      <CardContent className="px-1 py-1">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Quote className="size-3" />
          <span className="truncate">{m.prompt}</span>
        </div>
        {m.status === 'error' ? (
          <div className="text-xs text-destructive">{m.error}</div>
        ) : (
          <StreamingMarkdown text={m.answer} />
        )}
        {m.status === 'streaming' && (
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className={cn('size-1.5 rounded-full bg-primary animate-pulse')} />
            streaming…
          </div>
        )}
        {m.status === 'done' && m.finishReason === 'length' && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
            answer truncated — hit max output tokens. ask "continue" to resume.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
