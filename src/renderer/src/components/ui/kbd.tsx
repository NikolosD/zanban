import { cn } from '@renderer/lib/utils'

/**
 * Keyboard-cap badge. Two sizes:
 *   - "sm" (default): tight inline marker, used in tooltips and status pills.
 *   - "md": larger, bordered, used in the hotkey recorder where a key cap
 *     should stand on its own.
 */
export function Kbd({
  children,
  size = 'sm',
  className
}: {
  children: React.ReactNode
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded font-mono leading-none',
        size === 'sm'
          ? 'h-3.5 min-w-3.5 bg-white/10 px-1 text-[9px] text-foreground/80'
          : 'h-5 min-w-5 border border-white/15 bg-white/10 px-1.5 text-[10px] text-foreground',
        className
      )}
    >
      {children}
    </kbd>
  )
}
