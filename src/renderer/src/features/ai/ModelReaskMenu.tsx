import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import { PROVIDER_FAST_MODELS, PROVIDER_VISION_MODELS, type LlmProvider } from '@shared/types'
import { cn } from '@renderer/lib/utils'

/**
 * Per-request model-override picker for the dashboard AskPanel. Mirrors the
 * overlay's ModelOverridePicker (curated per-provider model list, "Default"
 * reset) but lives in the shared ai/ feature so both the override picker and
 * the answer-card "re-ask with model" menu can reuse it.
 *
 * When `onReask` is supplied each model item *also* fires onReask(model) so the
 * answer card can repeat the last prompt with a different model in one click.
 */
export function ModelReaskMenu({
  value,
  onChange,
  provider,
  onReask,
  triggerClassName,
  align = 'end'
}: {
  value: string | null
  onChange: (m: string | null) => void
  provider: LlmProvider
  /** Optional: re-ask the last prompt with the picked model. */
  onReask?: (m: string) => void
  triggerClassName?: string
  align?: 'start' | 'end'
}) {
  const { t } = useTranslation()
  const fastModels = PROVIDER_FAST_MODELS[provider] ?? []
  const visionModels = PROVIDER_VISION_MODELS[provider] ?? []

  const label = value
    ? value.includes('/')
      ? (value.split('/').pop() ?? value)
      : value
    : t('ask_panel.model_picker.default')

  function pick(model: string | null): void {
    onChange(model)
    if (model && onReask) onReask(model)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border/60',
          'bg-input/30 px-2 text-[10px] text-muted-foreground',
          'hover:bg-accent hover:text-foreground transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          triggerClassName
        )}
        title={t('ask_panel.model_picker.tooltip', { provider })}
      >
        <span className="max-w-[110px] truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[200px]">
        <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
          {t('ask_panel.model_picker.override_label', { provider })}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => pick(null)}>
          <span className={cn('flex-1 truncate text-[12px]', !value && 'text-foreground')}>
            {t('ask_panel.model_picker.default')}
          </span>
          {!value && <span className="text-[10px] text-emerald-400">●</span>}
        </DropdownMenuItem>
        {fastModels.length > 0 && <DropdownMenuSeparator />}
        {fastModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            {t('ask_panel.model_picker.text_answers')}
          </DropdownMenuLabel>
        )}
        {fastModels.map((m) => (
          <DropdownMenuItem key={`f-${m}`} onSelect={() => pick(m)}>
            <span
              className={cn(
                'flex-1 truncate font-mono text-[11px]',
                value === m && 'text-foreground'
              )}
            >
              {m}
            </span>
            {value === m && <span className="text-[10px] text-emerald-400">●</span>}
          </DropdownMenuItem>
        ))}
        {visionModels.length > 0 && <DropdownMenuSeparator />}
        {visionModels.length > 0 && (
          <DropdownMenuLabel className="text-[10px] font-mono uppercase text-muted-foreground">
            {t('ask_panel.model_picker.vision')}
          </DropdownMenuLabel>
        )}
        {visionModels.map((m) => (
          <DropdownMenuItem key={`v-${m}`} onSelect={() => pick(m)}>
            <span
              className={cn(
                'flex-1 truncate font-mono text-[11px]',
                value === m && 'text-foreground'
              )}
            >
              {m}
            </span>
            {value === m && <span className="text-[10px] text-emerald-400">●</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
