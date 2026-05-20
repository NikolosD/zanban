import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, LlmProvider } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { LLM_PROVIDERS } from './ProvidersTab'
import { cn } from '@renderer/lib/utils'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}

/**
 * Lets the user pick which providers to try when the active LLM call fails
 * before any chunks are streamed. Order matters — the chain runs top-to-bottom
 * and stops as soon as one provider answers. Providers without configured
 * credentials are silently skipped at runtime, so it's harmless to leave them
 * in the list.
 */
export function LlmFallbackOrderField({ settings, update }: Props) {
  const { t } = useTranslation()
  const order = settings.llmFallbackOrder ?? []
  const active = settings.llmProvider

  function set(next: LlmProvider[]) {
    update('llmFallbackOrder', next)
  }

  function add(id: LlmProvider) {
    if (order.includes(id)) return
    set([...order, id])
  }

  function remove(id: LlmProvider) {
    set(order.filter((p) => p !== id))
  }

  function move(id: LlmProvider, direction: -1 | 1) {
    const idx = order.indexOf(id)
    const target = idx + direction
    if (idx < 0 || target < 0 || target >= order.length) return
    const next = [...order]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item!)
    set(next)
  }

  const labelOf = (id: LlmProvider) =>
    LLM_PROVIDERS.find((p) => p.value === id) ? t(`settings.providers.llm.${id}.name`) : id

  const candidates = LLM_PROVIDERS.filter((p) => p.value !== active && !order.includes(p.value))

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
      <div className="mb-3">
        <div className="text-[14px] font-medium">{t('settings.providers.fallback_title')}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {t('settings.providers.fallback_hint')}
        </p>
      </div>

      {order.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/[0.08] bg-white/[0.01] px-3 py-4 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('settings.providers.fallback_empty')}
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {order.map((id, i) => {
            // The runtime skips the active provider when iterating the chain
            // (it has just failed). Gray it out here so the UI mirrors that.
            const isActiveInChain = id === active
            return (
              <li
                key={id}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5',
                  isActiveInChain && 'opacity-50'
                )}
              >
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="flex-1 text-[12px]">{labelOf(id)}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={() => move(id, -1)}
                  disabled={i === 0}
                  title={t('settings.providers.fallback_move_up')}
                >
                  <ChevronUp className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={() => move(id, 1)}
                  disabled={i === order.length - 1}
                  title={t('settings.providers.fallback_move_down')}
                >
                  <ChevronDown className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(id)}
                  title={t('settings.providers.fallback_remove')}
                >
                  <X className="size-3" />
                </Button>
              </li>
            )
          })}
        </ol>
      )}

      {candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('settings.providers.fallback_add_label')}
          </span>
          {candidates.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => add(p.value)}
            >
              <Plus className="size-3" />
              {t(`settings.providers.llm.${p.value}.name`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
