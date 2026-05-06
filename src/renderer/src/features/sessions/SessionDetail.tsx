import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Play,
  RotateCcw,
  Copy,
  Check,
  Download
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { startCapturesFromSettings } from '@renderer/audio/captureController'
import { useTranscript } from '@renderer/features/transcript/store'
import { useAi } from '@renderer/features/ai/store'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import type { SessionDetailPayload, StoredSegment, StoredExchange } from '@shared/api'
import type { SessionExportPayload } from '@shared/types'
import { toast } from 'sonner'

type TabId = 'summary' | 'transcript' | 'usage'

async function resume(id: string): Promise<void> {
  if (useTranscript.getState().session.kind === 'running') {
    toast.error(i18n.t('dashboard.session_running_elsewhere'))
    return
  }
  try {
    const settings = await window.zanban.settings.get()
    await window.zanban.session.start({ resumeId: id })
    await startCapturesFromSettings(settings)
  } catch (err) {
    toast.error(i18n.t('dashboard.could_not_resume'), {
      description: err instanceof Error ? err.message : String(err)
    })
  }
}

export function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack(): void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('summary')

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-detail-local', sessionId],
    queryFn: () => window.zanban.sessions.read(sessionId)
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t('session_detail.loading')}
      </div>
    )
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : t('dashboard.load_failed')}
      </p>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> {t('session_detail.back')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('session_detail.not_found')}</p>
      </div>
    )
  }

  const started = new Date(data.startedAt)
  const ended = data.endedAt ? new Date(data.endedAt) : null
  const dateLine = formatDateLine(started)

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-5">
      {/* Header row: back + status */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" /> {t('session_detail.back')}
        </Button>
        <div className="flex items-center gap-3">
          <ExportPdfButton session={data} />
          <div className="text-[12px] text-muted-foreground">{dateLine}</div>
        </div>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {data.title || formatFallbackTitle(started)}
        </h1>
      </div>

      {/* Tabs row */}
      <div className="flex items-center justify-between gap-3">
        <TabSwitcher tab={tab} setTab={setTab} />
        {tab === 'summary' && <SummaryActions session={data} />}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'summary' && <SummaryTab session={data} />}
        {tab === 'transcript' && <TranscriptTab segments={data.segments} />}
        {tab === 'usage' && <UsageTab session={data} ended={ended} startedAt={data.startedAt} />}
      </div>

      {/* Bottom action bar */}
      <BottomBar sessionId={data.id} />
    </div>
  )
}

function TabSwitcher({ tab, setTab }: { tab: TabId; setTab(v: TabId): void }) {
  const { t } = useTranslation()
  const TABS: Array<{ id: TabId }> = [{ id: 'summary' }, { id: 'transcript' }, { id: 'usage' }]
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-1">
      {TABS.map((tabDef) => (
        <button
          key={tabDef.id}
          onClick={() => setTab(tabDef.id)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
            tab === tabDef.id
              ? 'bg-white/[0.08] text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`session_detail.tabs.${tabDef.id}`)}
        </button>
      ))}
    </div>
  )
}

const SUMMARY_LABEL = '__zanban_session_summary__'

function ExportPdfButton({ session }: { session: SessionDetailPayload }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  async function exportPdf() {
    setBusy(true)
    try {
      const payload = buildExportPayload(session)
      const path = await window.zanban.documents.exportSessionPdf(payload)
      if (path) toast.success(t('session_detail.exported_toast'), { description: path })
    } catch (err) {
      toast.error(t('session_detail.export_failed_toast'), {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
      onClick={() => void exportPdf()}
      disabled={busy}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {t('session_detail.export_pdf')}
    </Button>
  )
}

function buildExportPayload(session: SessionDetailPayload): SessionExportPayload {
  type Block = SessionExportPayload['blocks'][number]
  const blocks: Block[] = []

  // Interleave transcript segments and Q&A exchanges by their timestamp so the
  // exported PDF reads in the same order things happened. Segments are anchored
  // by `startedAt + startMs`; exchanges by `createdAt`.
  const segs = session.segments.map((s) => ({
    kind: 'transcript' as const,
    speaker: s.channel === 'mic' ? 'You' : 'Them',
    text: s.text,
    ts: session.startedAt + s.startMs
  }))
  const xs = session.exchanges.map((e) => ({
    kind: 'qa' as const,
    question: e.prompt,
    answer: e.answer,
    ts: e.createdAt
  }))
  blocks.push(...segs, ...xs)
  blocks.sort((a, b) => a.ts - b.ts)

  return {
    title: session.title || `Session ${new Date(session.startedAt).toLocaleString()}`,
    startedAt: session.startedAt,
    blocks
  }
}

function SummaryActions({ session }: { session: SessionDetailPayload }) {
  const messages = useAi((s) => s.messages)
  const summary = [...messages].reverse().find((m) => m.prompt === SUMMARY_LABEL) ?? null
  const [copied, setCopied] = useState(false)

  async function copySummary() {
    if (!summary) return
    const ok = await copyToClipboard(summary.answer, 'Summary copied')
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  if (!summary) return null

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => void generateSummary(session)}
      >
        <RotateCcw className="size-3.5" /> Regenerate
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => void copySummary()}
      >
        {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
        Copy summary
      </Button>
    </div>
  )
}

function SummaryTab({ session }: { session: SessionDetailPayload }) {
  const messages = useAi((s) => s.messages)
  const summary = [...messages].reverse().find((m) => m.prompt === SUMMARY_LABEL) ?? null
  const [generating, setGenerating] = useState(false)

  async function generate() {
    if (generating) return
    setGenerating(true)
    try {
      await generateSummary(session)
    } finally {
      setGenerating(false)
    }
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-4 px-1">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          no summary yet
        </div>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Generate a quick AI summary of what was discussed. Uses the saved transcript only — no
          audio is sent.
        </p>
        <Button
          onClick={() => void generate()}
          disabled={generating || session.segments.length === 0}
          className="gap-2"
        >
          {generating && <Loader2 className="size-4 animate-spin" />}
          Generate summary
        </Button>
        {session.segments.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No transcript saved — nothing to summarize.
          </p>
        )}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full pr-3">
      <div className="prose-sm max-w-none">
        {summary.status === 'error' ? (
          <p className="text-sm text-destructive">{summary.error}</p>
        ) : (
          <div className="text-[14px] leading-relaxed text-foreground/95">
            <StreamingMarkdown text={summary.answer} />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

async function generateSummary(session: SessionDetailPayload): Promise<void> {
  if (session.segments.length === 0) {
    toast.error('No transcript to summarize.')
    return
  }
  const transcript = session.segments
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')
  const prompt = `Summarize this meeting transcript. Focus on the actual topics discussed and any decisions or open questions. Use 4-7 short bullets in clean Markdown. Keep it tight; no preamble.

<transcript>
${transcript}
</transcript>`

  try {
    const { requestId } = await window.zanban.ai.ask({ prompt })
    useAi.getState().newRequest(SUMMARY_LABEL, requestId)
  } catch (err) {
    const id = `err-${Date.now()}`
    useAi.getState().newRequest(SUMMARY_LABEL, id)
    useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
  }
}

function TranscriptTab({ segments }: { segments: StoredSegment[] }) {
  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No transcript saved.
      </div>
    )
  }
  return (
    <ScrollArea className="h-full pr-3">
      <div className="flex flex-col gap-1.5">
        {segments.map((s, i) => (
          <SegmentLine key={`${s.startMs}-${i}`} segment={s} />
        ))}
      </div>
    </ScrollArea>
  )
}

function UsageTab({
  session,
  startedAt,
  ended
}: {
  session: SessionDetailPayload
  startedAt: number
  ended: Date | null
}) {
  const { t } = useTranslation()
  const stats = useMemo(() => computeStats(session, startedAt, ended), [session, startedAt, ended])
  return (
    <ScrollArea className="h-full pr-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('session_detail.stats.duration')} value={stats.duration} />
        <Stat
          label={t('session_detail.stats.status')}
          value={
            ended ? t('session_detail.stats.completed') : t('session_detail.stats.in_progress')
          }
        />
        <Stat label={t('session_detail.stats.segments')} value={String(stats.totalSegments)} />
        <Stat
          label={t('session_detail.stats.you_them')}
          value={`${stats.youSegments} / ${stats.themSegments}`}
        />
        <Stat label={t('session_detail.stats.ai_exchanges')} value={String(stats.exchangeCount)} />
        <Stat
          label={t('session_detail.stats.avg_answer')}
          value={stats.avgAnswerChars ? `${stats.avgAnswerChars} chars` : '—'}
        />
        <Stat
          label={t('session_detail.stats.models_used')}
          value={stats.models.join(', ') || '—'}
          className="col-span-2"
        />
        <Stat
          label={t('session_detail.stats.last_activity')}
          value={stats.lastActivity || '—'}
          className="col-span-2"
        />
      </div>
      {session.exchanges.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <div className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('session_detail.recent_ai_exchanges')}
          </div>
          {session.exchanges
            .slice(-5)
            .reverse()
            .map((ex, i) => (
              <ExchangeRow key={`${ex.createdAt}-${i}`} exchange={ex} />
            ))}
        </div>
      )}
    </ScrollArea>
  )
}

function ExchangeRow({ exchange: ex }: { exchange: StoredExchange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">Q: {ex.prompt}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {new Date(ex.createdAt).toLocaleString()} · {ex.model ?? 'model'}
          </div>
        </div>
        <ArrowRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-3 py-2 text-[13px] leading-relaxed text-foreground/90">
          <StreamingMarkdown text={ex.answer} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div
      className={cn('rounded-lg border border-white/[0.06] bg-white/[0.015] px-4 py-3', className)}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-[15px] font-medium tabular-nums">{value}</div>
    </div>
  )
}

function BottomBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const q = text.trim()
    if (!q || busy) return
    const session = await window.zanban.sessions.read(sessionId).catch(() => null)
    if (!session) {
      toast.error(t('session_detail.cannot_read'))
      return
    }
    const transcript = session.segments
      .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
      .join('\n')
    const prompt = `You are answering a question about a past meeting. Use the saved transcript below as the only source of truth — do not make up details. Answer in 2-5 short sentences or bullets.

<transcript>
${transcript || '(empty)'}
</transcript>

<question>
${q}
</question>`
    setBusy(true)
    setText('')
    try {
      const { requestId } = await window.zanban.ai.ask({ prompt })
      useAi.getState().newRequest(`Q: ${q}`, requestId)
      toast.success(t('session_detail.asked_toast'))
    } catch (err) {
      toast.error(t('session_detail.ask_failed'), {
        description: err instanceof Error ? err.message : 'unknown'
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] p-1.5">
      <Button
        variant="default"
        size="sm"
        className="shrink-0 gap-1.5 rounded-full"
        onClick={() => void resume(sessionId)}
      >
        <Play className="size-3.5 fill-current" /> {t('session_detail.resume_session')}
      </Button>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
        placeholder={t('session_detail.ask_placeholder')}
        className="flex-1 bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 rounded-full"
        onClick={() => void send()}
        disabled={busy || !text.trim()}
        title={t('session_detail.send')}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
      </Button>
    </div>
  )
}

function SegmentLine({ segment: s }: { segment: StoredSegment }) {
  const isYou = s.channel === 'mic'
  return (
    <div className="flex items-start gap-2 leading-snug">
      <span
        className={cn(
          'mt-0.5 shrink-0 select-none font-mono text-[9px] font-semibold uppercase tracking-wider',
          isYou ? 'text-blue-400' : 'text-orange-400'
        )}
        style={{ width: 32 }}
      >
        {isYou ? 'You' : 'Them'}
      </span>
      <span
        className="font-mono text-[9px] text-muted-foreground/70 shrink-0"
        style={{ width: 36 }}
      >
        {formatMs(s.startMs)}
      </span>
      <span className="flex-1 text-[13px]">{s.text}</span>
    </div>
  )
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function formatDateLine(d: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dDay = new Date(d)
  dDay.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - dDay.getTime()) / 86_400_000)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 0) return `Today at ${time}`
  if (diffDays === 1) return `Yesterday at ${time}`
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function formatFallbackTitle(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function computeStats(
  session: SessionDetailPayload,
  startedAt: number,
  ended: Date | null
): {
  duration: string
  totalSegments: number
  youSegments: number
  themSegments: number
  exchangeCount: number
  avgAnswerChars: number | null
  models: string[]
  lastActivity: string | null
} {
  const endMs = ended ? ended.getTime() : Date.now()
  const durMs = Math.max(0, endMs - startedAt)
  const totalSegments = session.segments.length
  const youSegments = session.segments.filter((s) => s.channel === 'mic').length
  const themSegments = totalSegments - youSegments
  const exchangeCount = session.exchanges.length
  const avgAnswerChars = exchangeCount
    ? Math.round(session.exchanges.reduce((acc, e) => acc + e.answer.length, 0) / exchangeCount)
    : null
  const models = Array.from(
    new Set(session.exchanges.map((e) => e.model).filter((m): m is string => !!m))
  )
  const lastEx = session.exchanges.at(-1)
  const lastActivity = lastEx ? new Date(lastEx.createdAt).toLocaleString() : null
  return {
    duration: formatDuration(durMs),
    totalSegments,
    youSegments,
    themSegments,
    exchangeCount,
    avgAnswerChars,
    models,
    lastActivity
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m === 0) return `${s}s`
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}
