import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { PROMPT_VERSION } from '@shared/recap-types'
import type { SessionDetailPayload } from '@shared/api'
import type { RecapPayload, RecapResult } from '@shared/recap-types'
import { formatRecapAsMarkdown, formatFollowUpAsPlainText } from './recapActions'

export function RecapTab({ session }: { session: SessionDetailPayload }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const queryKey = ['recap', session.id]
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: recap } = useQuery<RecapPayload | null>({
    queryKey,
    queryFn: () => window.zanban.recap.get(session.id)
  })

  useEffect(() => {
    return window.zanban.recap.onUpdated((sessionId) => {
      if (sessionId === session.id) qc.invalidateQueries({ queryKey })
    })
  }, [qc, queryKey, session.id])

  const generate = useMutation<RecapResult, Error>({
    mutationFn: () => window.zanban.recap.generate(session.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey })
      if (!result.ok) setErrorMessage(result.message)
      else setErrorMessage(null)
    },
    onError: (e) => setErrorMessage(e.message)
  })

  const remove = useMutation<void, Error>({
    mutationFn: () => window.zanban.recap.delete(session.id),
    onSuccess: () => qc.invalidateQueries({ queryKey })
  })

  if (!recap && generate.isPending) return <RecapSkeleton />

  if (!recap) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-4 px-1">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('session_detail.recap.empty_label')}
        </div>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {t('session_detail.recap.empty_blurb')}
        </p>
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || session.segments.length === 0}
          className="gap-2"
        >
          {generate.isPending && <Loader2 className="size-4 animate-spin" />}
          {t('session_detail.recap.generate')}
        </Button>
        {errorMessage && <p className="text-[12px] text-destructive">{errorMessage}</p>}
      </div>
    )
  }

  const outdated = recap.promptVersion !== PROMPT_VERSION

  return (
    <ScrollArea className="h-full pr-3">
      <div className="flex flex-col gap-5">
        <RecapHeader
          recap={recap}
          outdated={outdated}
          onRegenerate={() => generate.mutate()}
          onCopyAll={() => {
            void copyToClipboard(formatRecapAsMarkdown(recap), t('common.copied'))
          }}
          onDelete={() => {
            if (confirm(t('session_detail.recap.delete_confirm'))) remove.mutate()
          }}
          busy={generate.isPending || remove.isPending}
        />
        {recap.partial && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {t('session_detail.recap.partial_warning')}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {errorMessage}
          </div>
        )}

        <TldrCard text={recap.tldr} />

        {recap.actionItems.length > 0 && (
          <Section
            title={t('session_detail.recap.action_items', { count: recap.actionItems.length })}
          >
            <ActionList sessionId={session.id} items={recap.actionItems} />
          </Section>
        )}

        {recap.decisions.length > 0 && (
          <Section title={t('session_detail.recap.decisions')}>
            <BulletList items={recap.decisions} />
          </Section>
        )}

        {recap.openQuestions.length > 0 && (
          <Section title={t('session_detail.recap.open_questions')}>
            <BulletList items={recap.openQuestions} muted />
          </Section>
        )}

        {recap.followUp && <FollowUpSection followUp={recap.followUp} />}
      </div>
    </ScrollArea>
  )
}

function RecapHeader({
  recap,
  outdated,
  busy,
  onRegenerate,
  onCopyAll,
  onDelete
}: {
  recap: RecapPayload
  outdated: boolean
  busy: boolean
  onRegenerate(): void
  onCopyAll(): void
  onDelete(): void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {recap.model} · {relativeAge(recap.generatedAt)}
        {recap.partial && (
          <span className="ml-2 text-amber-400">{t('session_detail.recap.partial_badge')}</span>
        )}
        {outdated && (
          <span className="ml-2 text-amber-400">{t('session_detail.recap.older_prompt')}</span>
        )}
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onRegenerate}
          disabled={busy}
        >
          <RotateCcw className="size-3.5" /> {t('session_detail.recap.regenerate')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onCopyAll} disabled={busy}>
          <Copy className="size-3.5" /> {t('session_detail.recap.copy_all')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onDelete} disabled={busy}>
          <Trash2 className="size-3.5" /> {t('session_detail.recap.delete')}
        </Button>
      </div>
    </div>
  )
}

function TldrCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[15px] leading-relaxed text-foreground/95">
      {text}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function BulletList({ items, muted = false }: { items: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-col gap-1 px-1">
      {items.map((it, i) => (
        <li
          key={i}
          className={cn(
            'flex gap-2 text-[13px] leading-relaxed',
            muted ? 'text-muted-foreground' : 'text-foreground/90'
          )}
        >
          <span aria-hidden="true">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function ActionList({
  sessionId,
  items
}: {
  sessionId: string
  items: Array<{ text: string; owner: 'you' | 'them' | 'unknown'; dueHint?: string }>
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((a, i) => (
        <ActionItem key={i} sessionId={sessionId} index={i} item={a} />
      ))}
    </ul>
  )
}

function ActionItem({
  sessionId,
  index,
  item
}: {
  sessionId: string
  index: number
  item: { text: string; owner: 'you' | 'them' | 'unknown'; dueHint?: string }
}) {
  const storageKey = `recap-checked-${sessionId}-${index}`
  const [checked, setChecked] = useState<boolean>(() => localStorage.getItem(storageKey) === '1')
  function toggle() {
    const next = !checked
    setChecked(next)
    if (next) localStorage.setItem(storageKey, '1')
    else localStorage.removeItem(storageKey)
  }
  const ownerLabel = item.owner === 'you' ? 'You' : item.owner === 'them' ? 'Them' : '?'
  const ownerColor =
    item.owner === 'you'
      ? 'text-blue-400 border-blue-500/40'
      : item.owner === 'them'
        ? 'text-orange-400 border-orange-500/40'
        : 'text-muted-foreground border-white/[0.08]'
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed">
      <input type="checkbox" checked={checked} onChange={toggle} className="mt-1.5" />
      <span
        className={cn(
          'mt-0.5 select-none rounded border px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider',
          ownerColor
        )}
      >
        {ownerLabel}
      </span>
      <span className={cn('flex-1', checked && 'line-through opacity-60')}>{item.text}</span>
      {item.dueHint && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.dueHint}</span>
      )}
    </li>
  )
}

function FollowUpSection({ followUp }: { followUp: { subject: string; body: string } }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-1 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('session_detail.recap.follow_up')}
        </span>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="mb-2 text-[13px] font-medium">{followUp.subject}</div>
          <div className="text-[13px] leading-relaxed text-foreground/90">
            <StreamingMarkdown text={followUp.body} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                void copyToClipboard(
                  `Subject: ${followUp.subject}\n\n${followUp.body}`,
                  t('common.copied')
                )
              }}
            >
              <Copy className="size-3.5" /> {t('session_detail.recap.copy_followup_md')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                void copyToClipboard(formatFollowUpAsPlainText(followUp), t('common.copied'))
              }}
            >
              <Copy className="size-3.5" /> {t('session_detail.recap.copy_followup_plain')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RecapSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-12 rounded-md bg-white/[0.04] animate-pulse" />
      <div className="flex flex-col gap-2">
        <div className="h-3 w-32 rounded bg-white/[0.04]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-full rounded bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function relativeAge(generatedAt: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - generatedAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(generatedAt).toLocaleDateString()
}
