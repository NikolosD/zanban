import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { useAi, wireAiIpc } from '@renderer/features/ai/store'
import { Toaster } from '@renderer/components/ui/sonner'
import { toast } from 'sonner'
import { ZanbanMark } from '@renderer/components/brand'

/**
 * Standalone chat window — talks to the AI without any meeting / transcript
 * context. Useful for "explain this", "help me phrase that", etc., outside
 * of a live call. Persona settings still apply.
 */
export function ChatApp() {
  const messages = useAi((s) => s.messages)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = wireAiIpc()
    return () => off()
  }, [])

  // Scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    try {
      const { requestId } = await window.zanban.ai.ask({ prompt: text })
      useAi.getState().newRequest(text, requestId)
    } catch (err) {
      toast.error('Failed to send', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
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
            zanban · chat
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => useAi.getState().reset()}
        >
          <Trash2 className="size-3" /> Clear
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-12 text-center text-[12px] text-muted-foreground">
            Ask anything. The active persona, RAG history, reference docs, and
            web search (if enabled) all apply here too.
          </div>
        ) : (
          <ul className="flex flex-col gap-5">
            {messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-2">
                <div className="rounded-md bg-white/[0.04] px-3 py-2 text-[13px]">
                  {m.prompt}
                </div>
                <div className="px-1 text-[13px]">
                  <StreamingMarkdown text={m.answer} />
                  {m.status === 'streaming' && (
                    <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                  )}
                  {m.status === 'error' && (
                    <span className="text-red-400">{m.error}</span>
                  )}
                </div>
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
          placeholder="Ask Zanban anything…"
          className="flex-1 resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] outline-none focus:border-white/30"
        />
        <Button
          variant="default"
          size="icon"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  )
}
