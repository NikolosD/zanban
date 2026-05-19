import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { DEFAULT_ANSWER_MAX_HEIGHT, clampAnswerHeight } from './answerPaneResize'

interface Props {
  /** Current max-height in px. Controlled. */
  value: number
  /** Runtime ceiling derived from screen.availHeight. */
  hardCap: number
  /** Fires live during drag with the proposed new height (already clamped). */
  onChange: (next: number) => void
  /** Fires once on mouseup / dblclick if the value actually changed during the gesture. */
  onCommit: (next: number) => void
}

/**
 * Thin horizontal grip between the answer history list and the input pill.
 * Dragging moves the inner scroll area's max-height. Double-click resets to
 * DEFAULT_ANSWER_MAX_HEIGHT. The OS window itself follows via the existing
 * ResizeObserver in OverlayApp.
 */
export function AnswerPaneResizer({ value, hardCap, onChange, onCommit }: Props) {
  // Capture the starting state at mousedown so each drag is computed relative
  // to where the gesture began — not the most recent intermediate value, which
  // would compound rounding errors.
  const startY = useRef<number | null>(null)
  const startValue = useRef<number>(value)
  const latestValue = useRef<number>(value)

  // Keep latestValue in sync with the prop so the mouseup commit sees the
  // value that was most recently emitted via onChange (parent has already
  // applied it back to `value` by the next render, but during a fast drag
  // we need it immediately).
  useEffect(() => {
    latestValue.current = value
  }, [value])

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (startY.current === null) return
      const delta = e.clientY - startY.current
      const next = clampAnswerHeight(startValue.current + delta, hardCap)
      latestValue.current = next
      onChange(next)
    },
    [hardCap, onChange]
  )

  const endDrag = useCallback(() => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', endDrag)
    if (startY.current === null) return
    const committed = latestValue.current
    const started = startValue.current
    startY.current = null
    if (committed !== started) onCommit(committed)
  }, [onMove, onCommit])

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startY.current = e.clientY
    startValue.current = value
    latestValue.current = value
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', endDrag)
  }

  const onDoubleClick = () => {
    if (value === DEFAULT_ANSWER_MAX_HEIGHT) return
    onChange(DEFAULT_ANSWER_MAX_HEIGHT)
    onCommit(DEFAULT_ANSWER_MAX_HEIGHT)
  }

  // Safety: detach on unmount in case the user navigated away mid-drag.
  useEffect(
    () => () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', endDrag)
    },
    [onMove, endDrag]
  )

  return (
    <div
      data-testid="answer-pane-resizer"
      data-interactive
      role="separator"
      aria-orientation="horizontal"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{ cursor: 'ns-resize', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'h-1.5 w-full shrink-0 bg-white/5 transition-colors',
        'hover:bg-white/15 active:bg-white/25'
      )}
    />
  )
}
