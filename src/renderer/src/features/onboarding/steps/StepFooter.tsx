import { cn } from '@renderer/lib/utils'

// Sticky to the bottom of the wizard's scroll body so a step's actions stay
// reachable when its content is taller than the dashboard window.
export function StepFooter({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 -mx-6 mt-2 flex items-center justify-between gap-2',
        'border-t border-border/60 bg-background px-6 py-3',
        className
      )}
    >
      {children}
    </div>
  )
}
