import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { hotkeyLabel } from '@renderer/lib/hotkeys'
import type { StepProps } from '../types'

const HEADLINE_KEYS = [
  'toggleOverlay',
  'askAi',
  'answerLast',
  'screenshot',
  'showDashboard'
] as const

function platformLabel(combo: string): string[] {
  return combo.split('+').map((p) => {
    const k = p.trim()
    if (k === 'Control') return 'Ctrl'
    if (k === 'Return') return '↵'
    if (k === 'Space') return 'Space'
    return k
  })
}

export function HotkeysStep({ settings, goNext, goBack }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">Hotkeys</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          The five keys that matter most. All of them are global — they fire even when another app
          has focus. Customize them later in Settings → Hotkeys.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
        {HEADLINE_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="text-[12px]">{hotkeyLabel(k)}</div>
            <div className="flex items-center gap-1">
              {platformLabel(settings.hotkeys[k]).map((part, i) => (
                <Kbd key={i}>{part}</Kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          Back
        </Button>
        <Button onClick={goNext}>Next</Button>
      </div>
    </div>
  )
}
