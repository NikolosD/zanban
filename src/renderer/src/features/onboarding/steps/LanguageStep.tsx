import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { StepProps } from '../types'

export function LanguageStep({ settings, update, goNext }: StepProps) {
  const current = settings.uiLocale
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">Welcome to Zanban</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          A stealth meeting copilot that listens to mic + system audio, transcribes locally, and
          answers questions for you. Everything is on your machine — API calls only when you ask the
          LLM.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          interface language
        </div>
        <div className="flex gap-2">
          <LangCard
            label="English"
            sublabel="Full support today."
            active={current === 'en'}
            onClick={() => void update('uiLocale', 'en')}
          />
          <LangCard
            label="Русский"
            sublabel="Скоро. Сейчас интерфейс на английском."
            active={current === 'ru'}
            onClick={() => void update('uiLocale', 'ru')}
          />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button onClick={goNext}>Next</Button>
      </div>
    </div>
  )
}

function LangCard({
  label,
  sublabel,
  active,
  onClick
}: {
  label: string
  sublabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10 text-foreground'
          : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
      )}
    >
      <div className="text-sm">{label}</div>
      <div className="text-[11px] text-muted-foreground">{sublabel}</div>
    </button>
  )
}
