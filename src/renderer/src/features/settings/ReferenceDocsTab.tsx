import { useCallback, useEffect, useId, useState } from 'react'
import { Trash2, UploadCloud, Loader2, FileType2, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { ReferenceDoc } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'

const ACCEPTED = '.pdf,.docx,.txt,.md'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function ReferenceDocsTab() {
  const { t } = useTranslation()
  const inputId = useId()
  const [docs, setDocs] = useState<ReferenceDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const refresh = useCallback(async () => {
    const list = await window.zanban.documents.list()
    setDocs(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    let alive = true
    void window.zanban.documents.list().then((list) => {
      if (!alive) return
      setDocs(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const upload = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setBusy(true)
      try {
        const results = await window.zanban.documents.upload(paths)
        const ok = results.filter((r): r is ReferenceDoc => 'id' in r).length
        const errs = results.filter((r): r is { error: string; path: string } => 'error' in r)
        if (ok > 0) {
          toast.success(t('settings.documents.upload_added', { count: ok }))
        }
        for (const e of errs) {
          toast.error(t('settings.documents.upload_failed', { path: e.path }), {
            description: e.error
          })
        }
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh, t]
  )

  // Electron 32 removed `File.path`; we now route the File through the
  // preload-exposed webUtils.getPathForFile to recover the absolute path.
  const filesToPaths = useCallback((files: File[]): string[] => {
    return files
      .map((f) => {
        try {
          return window.zanban.documents.getPathForFile(f)
        } catch {
          return ''
        }
      })
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setDragActive(false)
      const paths = filesToPaths(Array.from(e.dataTransfer?.files ?? []))
      if (paths.length === 0) {
        toast.error(t('settings.documents.drop_error'))
        return
      }
      void upload(paths)
    },
    [upload, filesToPaths, t]
  )

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const paths = filesToPaths(Array.from(e.target.files ?? []))
      e.target.value = ''
      if (paths.length === 0) {
        toast.error(t('settings.documents.pick_error'))
        return
      }
      void upload(paths)
    },
    [upload, filesToPaths, t]
  )

  const remove = useCallback(
    async (id: string, name: string) => {
      if (!confirm(t('settings.documents.delete_confirm', { name }))) return
      setDocs(await window.zanban.documents.remove(id))
    },
    [t]
  )

  const toggleActive = useCallback(async (id: string, active: boolean) => {
    setDocs(await window.zanban.documents.setActive(id, active))
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-mono text-meta uppercase tracking-[0.14em] text-muted-foreground">
          {t('settings.documents.title')}
        </h3>
        <p className="mt-1 text-small leading-relaxed text-muted-foreground">
          {t('settings.documents.hint')}
        </p>
      </div>

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/15 bg-white/[0.015] px-6 py-10 text-center transition-colors hover:border-white/30 hover:bg-white/[0.03]',
          // The input is visually hidden but focusable, so the drop zone
          // carries its keyboard focus ring.
          'has-[:focus-visible]:border-white/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
          dragActive && 'border-success/60 bg-success/5'
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloud className="size-5 text-muted-foreground" />
        )}
        <div className="text-body">
          {busy ? t('settings.documents.extracting') : t('settings.documents.drop_label')}
        </div>
        <div className="text-small text-muted-foreground">{t('settings.documents.accepted')}</div>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED}
          multiple
          disabled={busy}
          onChange={onPickFile}
          className="sr-only"
        />
      </label>

      {loading ? (
        <div className="flex items-center gap-2 text-small text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> {t('settings.documents.loading')}
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-md border border-white/[0.06] bg-white/[0.015] px-4 py-6 text-center text-small text-muted-foreground">
          {t('settings.documents.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              onToggleActive={(v) => void toggleActive(d.id, v)}
              onRemove={() => void remove(d.id, d.name)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function DocRow({
  doc: d,
  onToggleActive,
  onRemove
}: {
  doc: ReferenceDoc
  onToggleActive: (active: boolean) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [showText, setShowText] = useState(false)
  const empty = d.extractEmpty ?? d.text.trim().length === 0
  const hasText = d.text.trim().length > 0

  return (
    <li className="flex flex-col gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-3">
        <FileType2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body">{d.name}</span>
            {empty && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-meta font-medium text-warn">
                <AlertTriangle className="size-3" />
                {t('settings.documents.badge_no_text')}
              </span>
            )}
            {d.truncated && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-meta font-medium text-warn">
                {t('settings.documents.badge_truncated')}
              </span>
            )}
          </div>
          <div className="text-small text-muted-foreground">
            {d.kind.toUpperCase()} · {formatBytes(d.bytes)} ·{' '}
            {t('settings.documents.stats_chars', { count: d.text.length })}
          </div>
        </div>
        {hasText && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => setShowText((v) => !v)}
            aria-label={t('settings.documents.view_text_aria')}
            title={t('settings.documents.view_text_aria')}
          >
            {showText ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        )}
        <Switch
          checked={d.active}
          onCheckedChange={onToggleActive}
          aria-label={t('settings.documents.inject_aria')}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={t('settings.documents.remove_aria')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {empty && <p className="text-small text-warn">{t('settings.documents.empty_text_hint')}</p>}
      {showText && hasText && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-white/[0.06] bg-black/30 px-2.5 py-2 text-small leading-relaxed text-muted-foreground">
          {d.text}
        </pre>
      )}
    </li>
  )
}
