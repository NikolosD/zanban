import { useCallback, useEffect, useState } from 'react'
import { FileText, Trash2, UploadCloud, Loader2, FileType2 } from 'lucide-react'
import { toast } from 'sonner'
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
    void refresh()
  }, [refresh])

  const upload = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setBusy(true)
      try {
        const results = await window.zanban.documents.upload(paths)
        const ok = results.filter((r): r is ReferenceDoc => 'id' in r).length
        const errs = results.filter((r): r is { error: string; path: string } => 'error' in r)
        if (ok > 0) toast.success(`Added ${ok} document${ok === 1 ? '' : 's'}`)
        for (const e of errs) toast.error(`Failed: ${e.path}`, { description: e.error })
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh]
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
        toast.error('Could not read file paths from drop')
        return
      }
      void upload(paths)
    },
    [upload, filesToPaths]
  )

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const paths = filesToPaths(Array.from(e.target.files ?? []))
      e.target.value = ''
      if (paths.length === 0) {
        toast.error('Could not read file paths')
        return
      }
      void upload(paths)
    },
    [upload, filesToPaths]
  )

  const remove = useCallback(async (id: string) => {
    setDocs(await window.zanban.documents.remove(id))
  }, [])

  const toggleActive = useCallback(async (id: string, active: boolean) => {
    setDocs(await window.zanban.documents.setActive(id, active))
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Reference documents
        </h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          PDF, DOCX, TXT, MD. Active docs are injected into every AI request as
          context — useful for resumes, job descriptions, specs, briefs.
        </p>
      </div>

      <label
        htmlFor="ref-doc-input"
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/15 bg-white/[0.015] px-6 py-10 text-center transition-colors hover:border-white/30 hover:bg-white/[0.03]',
          dragActive && 'border-emerald-400/60 bg-emerald-400/5'
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloud className="size-5 text-muted-foreground" />
        )}
        <div className="text-[13px]">
          {busy ? 'Extracting…' : 'Drop files here or click to upload'}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Accepted: PDF, DOCX, TXT, MD
        </div>
        <input
          id="ref-doc-input"
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={onPickFile}
          className="hidden"
        />
      </label>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-md border border-white/[0.06] bg-white/[0.015] px-4 py-6 text-center text-[12px] text-muted-foreground">
          No reference documents yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
            >
              <FileType2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{d.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {d.kind.toUpperCase()} · {formatBytes(d.bytes)} · {d.text.length.toLocaleString()} chars
                </div>
              </div>
              <Switch
                checked={d.active}
                onCheckedChange={(v) => void toggleActive(d.id, v)}
                aria-label="Inject into prompts"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-red-400"
                onClick={() => void remove(d.id)}
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Re-export the icon so the parent can show it in the sidebar without
// re-importing lucide there.
export const REFERENCE_DOCS_ICON = FileText
