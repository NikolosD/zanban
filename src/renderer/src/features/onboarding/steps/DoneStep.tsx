import { CheckCircle2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import type { StepProps } from '../types'

export function DoneStep({ complete, goBack }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3">
        <CheckCircle2 className="size-8 text-primary" />
        <div>
          <h2 className="text-lg font-medium tracking-tight">You&apos;re set</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Hit <span className="text-foreground">Start session</span> in the dashboard header to
            begin recording. The overlay floats on top of your call and is invisible to screen-share
            by default. Stop by Settings any time to swap providers, edit hotkeys, or re-run this
            wizard.
          </p>
        </div>
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack}>
          Back
        </Button>
        <Button onClick={() => void complete()}>Finish</Button>
      </div>
    </div>
  )
}
