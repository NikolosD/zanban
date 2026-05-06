import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { LlmProvider } from '@shared/types'
import type { StepProps } from '../types'

interface ProviderOption {
  id: LlmProvider
  label: string
  blurb: string
  badge?: string
}

const OPTIONS: ProviderOption[] = [
  {
    id: 'vercel-gateway',
    label: 'Vercel AI Gateway',
    blurb: 'Single key fans out to OpenAI, Anthropic, Gemini, Groq. Recommended for most users.',
    badge: 'recommended'
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    blurb: 'Direct Claude API. Strong reasoning, good at structured replies.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'Direct OpenAI API. Vision-ready out of the box.'
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    blurb: 'Fully on-device. No API key needed — point at your local Ollama install.',
    badge: 'no key'
  }
]

export function ProviderStep({
  draftProvider,
  setDraftProvider,
  update,
  goNext,
  goBack
}: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">Pick an LLM provider</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          You can switch later in Settings. Cloud providers stream answers faster; Ollama keeps
          everything on your machine.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setDraftProvider(opt.id)}
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
              draftProvider === opt.id
                ? 'border-primary/60 bg-primary/10'
                : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
            )}
          >
            <div
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                draftProvider === opt.id ? 'bg-primary' : 'bg-muted-foreground/40'
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{opt.label}</span>
                {opt.badge && (
                  <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                    {opt.badge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {opt.blurb}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          Back
        </Button>
        <Button
          onClick={async () => {
            await update('llmProvider', draftProvider)
            goNext()
          }}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
