import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Download, Upload, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings, Persona, ResponseLanguage } from '@shared/types'
import { RESPONSE_LANGUAGES, AI_MODEL_SUGGESTIONS } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}

export function PersonasTab({ settings, update }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.zanban.personas.list()
    setPersonas(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setActive = (id: string | null) => update('activePersonaId', id)

  async function createNew() {
    const persona = await window.zanban.personas.create({
      name: 'New persona',
      systemPrompt: ''
    })
    await refresh()
    setEditingId(persona.id)
  }

  async function remove(id: string) {
    if (!confirm('Delete this persona?')) return
    await window.zanban.personas.delete(id)
    if (settings.activePersonaId === id) setActive(null)
    if (editingId === id) setEditingId(null)
    await refresh()
  }

  async function exportAll() {
    try {
      const json = await window.zanban.personas.exportJson()
      await navigator.clipboard.writeText(json)
      toast.success('Personas JSON copied to clipboard')
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Clipboard is empty')
        return
      }
      const result = await window.zanban.personas.importJson(text)
      toast.success(`Imported ${result.added}, skipped ${result.skipped}`)
      await refresh()
    } catch (err) {
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Personas
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Pick the active persona — its system prompt drives every AI request.
            Built-ins can be edited or deleted; create your own with the + button.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void importFromClipboard()}>
            <Upload className="size-3.5" /> Import
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void exportAll()}>
            <Download className="size-3.5" /> Export
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void createNew()}>
            <Plus className="size-3.5" /> New
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {personas.map((p) => {
          const active = settings.activePersonaId === p.id
          const editing = editingId === p.id
          return (
            <li
              key={p.id}
              className={cn(
                'rounded-md border bg-white/[0.02]',
                active ? 'border-emerald-400/40' : 'border-white/[0.06]'
              )}
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
                onClick={() => setEditingId(editing ? null : p.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px]">{p.name}</span>
                    {p.builtin && (
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        builtin
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {p.systemPrompt.slice(0, 80) || '(empty prompt)'}
                  </div>
                </div>
                {active && <Check className="size-4 text-emerald-400" />}
              </button>
              {editing && (
                <PersonaEditor
                  persona={p}
                  onChange={async (patch) => {
                    await window.zanban.personas.update(p.id, patch)
                    await refresh()
                  }}
                  onDelete={() => remove(p.id)}
                  onActivate={() => setActive(p.id)}
                  onClearActive={() => setActive(null)}
                  isActive={active}
                />
              )}
            </li>
          )
        })}
        {personas.length === 0 && (
          <li className="rounded-md border border-white/[0.06] bg-white/[0.015] px-4 py-6 text-center text-[12px] text-muted-foreground">
            No personas yet. Click "New" to create one.
          </li>
        )}
      </ul>
    </div>
  )
}

interface EditorProps {
  persona: Persona
  isActive: boolean
  onChange(patch: Partial<Persona>): Promise<void>
  onDelete(): void
  onActivate(): void
  onClearActive(): void
}

function PersonaEditor({ persona, isActive, onChange, onDelete, onActivate, onClearActive }: EditorProps) {
  const [name, setName] = useState(persona.name)
  const [prompt, setPrompt] = useState(persona.systemPrompt)
  const [model, setModel] = useState(persona.defaultModel ?? '')
  const [language, setLanguage] = useState<ResponseLanguage | ''>(persona.responseLanguage ?? '')
  const ragUse = persona.ragStrategy?.useRag !== false
  const ragK = persona.ragStrategy?.topK ?? 6

  return (
    <div className="flex flex-col gap-3 border-t border-white/[0.06] px-3 py-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== persona.name && void onChange({ name })}
        placeholder="Persona name"
      />
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => prompt !== persona.systemPrompt && void onChange({ systemPrompt: prompt })}
        rows={6}
        placeholder="System prompt that defines this persona's behavior…"
        className="font-mono text-[12px]"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">Default fast model (optional)</label>
          <Select
            value={model || '__inherit__'}
            onValueChange={(v) => {
              const next = v === '__inherit__' ? '' : v
              setModel(next)
              void onChange({ defaultModel: next || undefined })
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit from settings</SelectItem>
              {AI_MODEL_SUGGESTIONS.fast.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Response language (optional)</label>
          <Select
            value={language || '__inherit__'}
            onValueChange={(v) => {
              const next = v === '__inherit__' ? '' : (v as ResponseLanguage)
              setLanguage(next)
              void onChange({ responseLanguage: next || undefined })
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit from settings</SelectItem>
              {RESPONSE_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <div className="flex-1">
          <div className="text-[12px]">RAG (history retrieval)</div>
          <div className="text-[11px] text-muted-foreground">
            Pull relevant snippets from past sessions into the prompt.
          </div>
        </div>
        <input
          type="number"
          min={1}
          max={20}
          value={ragK}
          disabled={!ragUse}
          onChange={(e) => {
            const v = Math.max(1, Math.min(20, Number(e.target.value) || 6))
            void onChange({
              ragStrategy: {
                useRag: ragUse,
                topK: v,
                distanceThreshold: persona.ragStrategy?.distanceThreshold ?? 1.2
              }
            })
          }}
          className="w-14 rounded border border-white/[0.08] bg-transparent px-2 py-1 text-[12px]"
          aria-label="RAG top-K"
        />
        <Switch
          checked={ragUse}
          onCheckedChange={(v) =>
            void onChange({
              ragStrategy: {
                useRag: v,
                topK: ragK,
                distanceThreshold: persona.ragStrategy?.distanceThreshold ?? 1.2
              }
            })
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        {isActive ? (
          <Button variant="ghost" size="sm" onClick={onClearActive}>
            Stop using this persona
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={onActivate}>
            <Check className="size-3.5" /> Activate
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-red-400 hover:text-red-300"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </div>
  )
}
