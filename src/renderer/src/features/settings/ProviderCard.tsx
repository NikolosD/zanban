import { useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { ProviderStatusDot, type ProviderDotStatus } from '@renderer/components/ProviderStatusDot'
import { cn } from '@renderer/lib/utils'

export interface ProviderCardProps {
  /** Provider id used as react key in caller. */
  id: string
  /** Display name, e.g. "Deepgram Nova-3" or "OpenAI". */
  name: string
  /** Short subtitle shown under the name. */
  description: string
  /** Active provider — drawn with sage ring + "active" tag. */
  active: boolean
  /** "recommended" or "experimental" or null. */
  badge?: 'recommended' | 'experimental' | 'local' | null
  /** Status dot drawn next to the provider name. Optional — when omitted no
   *  dot is rendered (keeps the existing layout for callers that don't yet
   *  pass a status). */
  status?: ProviderDotStatus
  /** Click on the body to make this the active provider. */
  onActivate?: () => void
  /** External link to the provider's API console (the "get key →" affordance). */
  keyUrl?: string
  /** Renders inside the body — typically an API key input + auxiliary fields. */
  children?: React.ReactNode
}

const BADGE_STYLES: Record<NonNullable<ProviderCardProps['badge']>, string> = {
  recommended: 'bg-accent/10 text-accent border-accent/30',
  experimental: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  local: 'bg-white/5 text-muted-foreground border-white/10'
}

/**
 * Natively-style provider card. All cards stack vertically, each one shows
 * the provider name, a short blurb, a "get key →" link and (when active)
 * the inline credential editor + a sage check.
 *
 * The whole card is a button that activates the provider — clicking inside
 * the children (input fields) doesn't bubble (we stop propagation on click).
 */
export function ProviderCard({
  name,
  description,
  active,
  badge,
  status,
  onActivate,
  keyUrl,
  children
}: ProviderCardProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border bg-white/[0.02] px-4 py-4',
        'transition-colors',
        active
          ? 'border-accent/40 bg-accent/[0.04] shadow-[0_0_0_1px_oklch(0.78_0.13_145/0.20)_inset]'
          : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04]'
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {status && <ProviderStatusDot status={status} />}
            <span className="text-[14px] font-medium leading-none text-foreground">{name}</span>
            {badge && (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] leading-none',
                  BADGE_STYLES[badge]
                )}
              >
                {badge}
              </span>
            )}
            {active && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] leading-none text-accent">
                <Check className="size-2.5" />
                active
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">{description}</p>
        </div>
        {keyUrl && (
          <a
            onClick={(e) => e.stopPropagation()}
            href={keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-white/[0.14] hover:text-foreground"
            title="Open the provider's API console to get a key"
          >
            get key
            <ExternalLink className="size-3" />
          </a>
        )}
      </button>
      {/* Credentials slot — only meaningful for the active provider, but the
          caller may render it always so the user can pre-fill keys without
          activating. */}
      {children && <div onClick={(e) => e.stopPropagation()}>{children}</div>}
    </div>
  )
}

/**
 * Reusable secret-key field. Shared between LLM and STT cards.
 */
export function SecretKeyField({
  label,
  placeholder,
  value,
  onChange
}: {
  label?: string
  placeholder?: string
  value: string
  onChange(v: string): void
}) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex items-center gap-1">
        <Input
          value={value}
          type={reveal ? 'text' : 'password'}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'paste key here…'}
          className="flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide key' : 'Reveal key'}
        >
          {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}
