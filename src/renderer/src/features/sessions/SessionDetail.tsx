import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { Tabs } from 'radix-ui'
import { ArrowLeft, ArrowRight, Loader2, Download, Pencil, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import { errorMessage } from '@renderer/lib/errors'
import { queryKeys } from '@renderer/lib/queryKeys'
import { formatDuration } from '@renderer/lib/dateFormat'
import { useStickToBottom } from '@renderer/lib/useStickToBottom'
import { resumeSession } from '@renderer/features/transcript/sessionStart'
import { useTranscript } from '@renderer/features/transcript/store'
import { useSettingsStore } from '@renderer/features/settings/store'
import { useAi } from '@renderer/features/ai/store'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import type { SessionDetailPayload, StoredSegment, StoredExchange } from '@shared/api'
import { RecapTab } from './RecapTab'
import { quickActionLabel } from './quickActionLabel'
import type { SessionExportPayload } from '@shared/types'
import type { RecapPayload } from '@shared/recap-types'
import { toast } from 'sonner'

type TabId = 'recap' | 'transcript' | 'stats'

export function SessionDetail({
  sessionId,
  afterCall = false,
  onBack,
  onOpenSettings
}: {
  sessionId: string
  /** Opened straight from the end of this call, so the recap is the place to land. */
  afterCall?: boolean
  onBack(): void
  onOpenSettings?(): void
}) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState<TabId | null>(null)
  const autoRecap = useSettingsStore((s) => s.settings?.recap.autoGenerate ?? false)
  const live = useTranscript(
    (s) => s.session.kind === 'running' && s.session.sessionId === sessionId
  )

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sessionDetail(sessionId),
    queryFn: () => window.zanban.sessions.read(sessionId),
    // During the call the record on disk grows every few seconds.
    refetchInterval: live ? 3000 : false
  })
  const { data: recap } = useQuery({
    queryKey: queryKeys.recap(sessionId),
    queryFn: () => window.zanban.recap.get(sessionId)
  })
  // Until a recap exists the transcript is the useful view, unless the call
  // just ended and the recap is the thing the user came for.
  const activeTab = tab ?? (recap === null && !afterCall ? 'transcript' : 'recap')

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t('session_detail.loading')}
      </div>
    )
  }
  if (error) {
    return (
      <p className="text-body text-destructive">
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
        <p className="text-body text-muted-foreground">
          {live ? t('session_detail.live_pending') : t('session_detail.not_found')}
        </p>
      </div>
    )
  }

  const started = new Date(data.startedAt)
  const ended = data.endedAt ? new Date(data.endedAt) : null
  const dateLine = formatDateLine(started, t, i18n.language)

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
          <div className="text-small text-muted-foreground">{dateLine}</div>
        </div>
      </div>

      {/* Title (inline-editable) */}
      <EditableTitle
        sessionId={data.id}
        title={data.title}
        fallback={t('dashboard.row.untitled')}
      />

      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setTab(v as TabId)}
        className="flex min-h-0 flex-1 flex-col gap-5"
      >
        <TabSwitcher />
        <Tabs.Content value="recap" className="min-h-0 flex-1 overflow-hidden">
          <RecapTab session={data} awaitingAuto={afterCall && autoRecap} />
        </Tabs.Content>
        <Tabs.Content value="transcript" className="min-h-0 flex-1 overflow-hidden">
          <TranscriptTab session={data} />
        </Tabs.Content>
        <Tabs.Content value="stats" className="min-h-0 flex-1 overflow-hidden">
          <StatsTab session={data} ended={ended} />
        </Tabs.Content>
      </Tabs.Root>

      {/* Bottom action bar */}
      <BottomBar sessionId={data.id} onOpenSettings={onOpenSettings} />
    </div>
  )
}

function EditableTitle({
  sessionId,
  title,
  fallback
}: {
  sessionId: string
  title: string | null
  fallback: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The draft starts from the current title each time editing starts, so a
  // regenerated title or another session is never edited from a stale copy.
  function startEditing() {
    setDraft(title ?? '')
    setEditing(true)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function commit() {
    const next = draft.trim()
    setSaving(true)
    try {
      const res = await window.zanban.sessions.rename(sessionId, next)
      if (res.ok) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.sessionDetail(sessionId) }),
          qc.invalidateQueries({ queryKey: queryKeys.sessions }),
          // Action items link back to their session by title.
          qc.invalidateQueries({ queryKey: queryKeys.globalActionItems })
        ])
        setEditing(false)
      } else {
        toast.error(t('session_detail.rename_failed'))
      }
    } catch (err) {
      toast.error(t('session_detail.rename_failed'), {
        description: errorMessage(err)
      })
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(title ?? '')
              setEditing(false)
            }
          }}
          onBlur={() => void commit()}
          placeholder={fallback}
          aria-label={t('session_detail.rename_label')}
          className="w-full bg-transparent text-display font-semibold tracking-tight text-foreground outline-none border-b border-white/15 focus:border-white/40"
        />
        {saving && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-2">
      <h1
        className={cn(
          'text-display font-semibold tracking-tight cursor-text',
          !title && 'text-muted-foreground'
        )}
        onDoubleClick={startEditing}
        title={t('session_detail.rename_label')}
      >
        {title || fallback}
      </h1>
      <button
        type="button"
        onClick={startEditing}
        aria-label={t('session_detail.rename_label')}
        title={t('session_detail.rename_label')}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
    </div>
  )
}

const TAB_IDS: TabId[] = ['recap', 'transcript', 'stats']

function TabSwitcher() {
  const { t } = useTranslation()
  return (
    <Tabs.List className="flex items-center gap-6 border-b border-border">
      {TAB_IDS.map((id) => (
        <Tabs.Trigger
          key={id}
          value={id}
          className={cn(
            '-mb-px border-b border-transparent pb-2 text-body text-muted-foreground transition-colors',
            'hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground'
          )}
        >
          {t(`session_detail.tabs.${id}`)}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  )
}

function ExportPdfButton({ session }: { session: SessionDetailPayload }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)

  async function exportPdf() {
    setBusy(true)
    try {
      // Pull the persisted recap (if any) so the export is one full document —
      // structured recap on top, the timeline below. recap.get returns null
      // when no recap was generated, in which case the section is simply omitted.
      const recap = await window.zanban.recap.get(session.id).catch(() => null)
      const payload = buildExportPayload(session, t, i18n.language, recap)
      const path = await window.zanban.documents.exportSessionPdf(payload)
      if (path) toast.success(t('session_detail.exported_toast'), { description: path })
    } catch (err) {
      toast.error(t('session_detail.export_failed_toast'), {
        description: errorMessage(err)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-small text-muted-foreground hover:text-foreground"
      onClick={() => void exportPdf()}
      disabled={busy}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {t('session_detail.export_pdf')}
    </Button>
  )
}

function buildExportPayload(
  session: SessionDetailPayload,
  t: TFunction,
  locale: string,
  recap?: RecapPayload | null
): SessionExportPayload {
  type Block = SessionExportPayload['blocks'][number]
  const blocks: Block[] = []

  // Interleave transcript segments and Q&A exchanges by their timestamp so the
  // exported PDF reads in the same order things happened. Segments are anchored
  // by `startedAt + startMs`; exchanges by `createdAt`.
  const segs = session.segments.map((s) => ({
    kind: 'transcript' as const,
    speaker:
      s.channel === 'mic' ? t('session_detail.speaker.you') : t('session_detail.speaker.them'),
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
    title:
      session.title ||
      t('session_detail.export_title_fallback', {
        date: formatDateTime(session.startedAt, locale)
      }),
    startedAt: session.startedAt,
    blocks,
    recap: recap
      ? {
          tldr: recap.tldr,
          decisions: recap.decisions,
          actionItems: recap.actionItems,
          openQuestions: recap.openQuestions,
          followUp: recap.followUp
        }
      : undefined
  }
}

type TimelineItem =
  | { kind: 'turn'; channel: StoredSegment['channel']; startMs: number; lines: string[] }
  | { kind: 'exchange'; exchange: StoredExchange; atMs: number }

/**
 * Transcript as speaker turns (consecutive segments from one channel merged)
 * with the AI exchanges from the call slotted in by time — the same ordering
 * the PDF export uses.
 */
function buildTimeline(session: SessionDetailPayload): TimelineItem[] {
  const events: Array<
    { ts: number; segment: StoredSegment } | { ts: number; exchange: StoredExchange }
  > = [
    ...session.segments.map((segment) => ({ ts: session.startedAt + segment.startMs, segment })),
    ...session.exchanges.map((exchange) => ({ ts: exchange.createdAt, exchange }))
  ]
  events.sort((a, b) => a.ts - b.ts)

  const items: TimelineItem[] = []
  for (const ev of events) {
    if ('exchange' in ev) {
      items.push({
        kind: 'exchange',
        exchange: ev.exchange,
        atMs: Math.max(0, ev.ts - session.startedAt)
      })
      continue
    }
    const { segment } = ev
    const last = items.at(-1)
    if (last?.kind === 'turn' && last.channel === segment.channel) {
      last.lines.push(segment.text)
    } else {
      items.push({
        kind: 'turn',
        channel: segment.channel,
        startMs: segment.startMs,
        lines: [segment.text]
      })
    }
  }
  return items
}

function TranscriptTab({ session }: { session: SessionDetailPayload }) {
  const { t } = useTranslation()
  const timeline = useMemo(() => buildTimeline(session), [session])
  if (timeline.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-body text-muted-foreground">
        {t('session_detail.no_transcript')}
      </div>
    )
  }
  return (
    <ScrollArea className="h-full pr-3">
      <div className="flex flex-col gap-4">
        {timeline.map((item, i) =>
          item.kind === 'turn' ? (
            <SpeakerTurn
              key={`turn-${i}`}
              channel={item.channel}
              startMs={item.startMs}
              lines={item.lines}
            />
          ) : (
            <ExchangeRow
              key={`exchange-${i}`}
              exchange={item.exchange}
              stamp={formatMs(item.atMs)}
            />
          )
        )}
      </div>
    </ScrollArea>
  )
}

function SpeakerTurn({
  channel,
  startMs,
  lines
}: {
  channel: StoredSegment['channel']
  startMs: number
  lines: string[]
}) {
  const { t } = useTranslation()
  const isYou = channel === 'mic'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 font-mono text-small">
        <span className={isYou ? 'text-foreground' : 'text-muted-foreground'}>
          {isYou ? t('session_detail.speaker.you') : t('session_detail.speaker.them')}
        </span>
        <span className="tabular-nums text-muted-foreground">{formatMs(startMs)}</span>
      </div>
      {lines.map((line, i) => (
        <p key={i} className="max-w-[70ch] text-sm leading-[1.6] text-foreground/90">
          {line}
        </p>
      ))}
    </div>
  )
}

function StatsTab({ session, ended }: { session: SessionDetailPayload; ended: Date | null }) {
  const { t, i18n } = useTranslation()
  const stats = useMemo(
    () => computeStats(session, ended, i18n.language),
    [session, ended, i18n.language]
  )
  const rows: Array<[string, string]> = [
    [t('session_detail.stats.duration'), stats.duration],
    [
      t('session_detail.stats.status'),
      ended ? t('session_detail.stats.completed') : t('session_detail.stats.in_progress')
    ],
    [t('session_detail.stats.segments'), String(stats.totalSegments)],
    [t('session_detail.stats.you_them'), `${stats.youSegments} / ${stats.themSegments}`],
    [t('session_detail.stats.ai_exchanges'), String(stats.exchangeCount)],
    [
      t('session_detail.stats.avg_answer'),
      stats.avgAnswerChars ? t('session_detail.stats.chars', { count: stats.avgAnswerChars }) : '—'
    ],
    [t('session_detail.stats.models_used'), stats.models.join(', ') || '—'],
    [t('session_detail.stats.last_activity'), stats.lastActivity || '—']
  ]
  return (
    <ScrollArea className="h-full pr-3">
      <dl className="grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-8 gap-y-2 text-body">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate tabular-nums text-foreground">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {session.exchanges.length > 0 && (
        <div className="mt-8 flex flex-col gap-2">
          <div className="px-1 font-mono text-meta uppercase tracking-wider text-muted-foreground">
            {t('session_detail.recent_ai_exchanges')}
          </div>
          {session.exchanges
            .slice(-5)
            .reverse()
            .map((ex, i) => (
              <ExchangeRow
                key={`${ex.createdAt}-${i}`}
                exchange={ex}
                stamp={formatDateTime(ex.createdAt, i18n.language)}
              />
            ))}
        </div>
      )}
    </ScrollArea>
  )
}

function ExchangeRow({ exchange: ex, stamp }: { exchange: StoredExchange; stamp: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-[70ch] rounded-md border border-white/[0.06] bg-white/[0.015]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-body">
            {quickActionLabel(ex.prompt, t) ??
              t('session_detail.question_label', { question: ex.prompt })}
          </div>
          <div className="font-mono text-meta text-muted-foreground">
            {stamp}
            {ex.model && ` · ${ex.model}`}
          </div>
        </div>
        <ArrowRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-3 py-2 text-body leading-relaxed text-foreground/90">
          <StreamingMarkdown text={ex.answer} />
        </div>
      )}
    </div>
  )
}

function BottomBar({ sessionId, onOpenSettings }: { sessionId: string; onOpenSettings?(): void }) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const answer = useAi((s) => s.messages.find((m) => m.id === requestId))
  const { rootRef: answerRef } = useStickToBottom<HTMLDivElement>(answer?.id, answer?.answer.length)

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
    const id = crypto.randomUUID()
    useAi.getState().newRequest(t('session_detail.question_label', { question: q }), id)
    setRequestId(id)
    try {
      await window.zanban.ai.ask({ requestId: id, prompt, skipRetrieval: true })
    } catch (err) {
      useAi.getState().failRequest(id, errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2">
      {answer && (
        <div
          ref={answerRef}
          className="max-h-[40vh] overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
        >
          <div className="mb-2 flex items-center gap-2 font-mono text-meta text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{answer.prompt}</span>
            {answer.status === 'streaming' && (
              <Loader2
                className="size-3 shrink-0 animate-spin"
                aria-label={t('ask_panel.streaming')}
              />
            )}
            <button
              type="button"
              onClick={() => setRequestId(null)}
              aria-label={t('session_detail.dismiss_answer')}
              title={t('session_detail.dismiss_answer')}
              className="shrink-0 transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {answer.status === 'error' ? (
            <p className="text-small text-destructive">{answer.error}</p>
          ) : (
            <div className="max-w-[70ch] text-body">
              <StreamingMarkdown text={answer.answer} streaming={answer.status === 'streaming'} />
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 rounded-full text-small text-muted-foreground hover:text-foreground"
          onClick={() => void resumeSession(sessionId, onOpenSettings)}
        >
          {t('session_detail.resume_session')}
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
          aria-label={t('session_detail.ask_placeholder')}
          className="flex-1 bg-transparent px-2 text-body text-foreground placeholder:text-muted-foreground/60 outline-none"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-full"
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          title={t('session_detail.send')}
          aria-label={t('session_detail.send')}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowRight className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function formatDateTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatDateLine(d: Date, t: TFunction, locale: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dDay = new Date(d)
  dDay.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - dDay.getTime()) / 86_400_000)
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 0) return t('session_detail.today_at', { time })
  if (diffDays === 1) return t('session_detail.yesterday_at', { time })
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function computeStats(
  session: SessionDetailPayload,
  ended: Date | null,
  locale: string
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
  const durMs = Math.max(0, endMs - session.startedAt)
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
  const lastActivity = lastEx ? formatDateTime(lastEx.createdAt, locale) : null
  return {
    duration: formatDuration(durMs) ?? '—',
    totalSegments,
    youSegments,
    themSegments,
    exchangeCount,
    avgAnswerChars,
    models,
    lastActivity
  }
}
