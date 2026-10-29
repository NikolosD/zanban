import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  DEFAULT_ANSWER_MAX_HEIGHT,
  MIN_ANSWER_MAX_HEIGHT,
  clampAnswerHeight
} from './answerPaneResize'

const KEY_STEP = 20
const KEY_STEP_LARGE = 80

interface Props {
  /** Current max-height in px. Controlled. */
  value: number
  /** Runtime ceiling derived from screen.availHeight. */
  hardCap: number
  /** Fires live during drag with the proposed new height (already clamped). */
  onChange: (next: number) => void
  /** Fires once per gesture (mouseup, dblclick, key press) if the value actually changed. */
  onCommit: (next: number) => void
}

/**
 * Thin horizontal grip between the answer history list and the input pill.
 * Dragging (or ArrowUp/ArrowDown, Shift for bigger steps, Home/End) moves the
 * inner scroll area's max-height. Double-click resets to
 * DEFAULT_ANSWER_MAX_HEIGHT. The OS window itself follows via the existing
 * ResizeObserver in OverlayApp.
 */
export function AnswerPaneResizer({ value, hardCap, onChange, onCommit }: Props) {
  const { t } = useTranslation()
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

  // Listeners of the drag in progress; aborting removes them all at once.
  const dragListeners = useRef<AbortController | null>(null)

  const endDrag = useCallback(() => {
    dragListeners.current?.abort()
    dragListeners.current = null
    if (startY.current === null) return
    const committed = latestValue.current
    const started = startValue.current
    startY.current = null
    if (committed !== started) onCommit(committed)
  }, [onCommit])

  const onMouseDown = (e: React.MouseEvent) => {
    if (startY.current !== null) return // already dragging — ignore re-entrant mousedown
    e.preventDefault()
    startY.current = e.clientY
    startValue.current = value
    latestValue.current = value
    dragListeners.current = new AbortController()
    const { signal } = dragListeners.current
    document.addEventListener('mousemove', onMove, { signal })
    document.addEventListener('mouseup', endDrag, { signal })
  }

  const onDoubleClick = () => {
    if (value === DEFAULT_ANSWER_MAX_HEIGHT) return
    onChange(DEFAULT_ANSWER_MAX_HEIGHT)
    onCommit(DEFAULT_ANSWER_MAX_HEIGHT)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    let next: number
    if (e.key === 'ArrowDown') next = value + step
    else if (e.key === 'ArrowUp') next = value - step
    else if (e.key === 'Home') next = MIN_ANSWER_MAX_HEIGHT
    else if (e.key === 'End') next = hardCap
    else return
    e.preventDefault()
    next = clampAnswerHeight(next, hardCap)
    if (next === value) return
    onChange(next)
    onCommit(next)
  }

  // Safety: detach on unmount in case the user navigated away mid-drag.
  useEffect(() => () => dragListeners.current?.abort(), [])

  return (
    <div
      data-testid="answer-pane-resizer"
      data-interactive
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('overlay.resize_answer')}
      aria-valuemin={MIN_ANSWER_MAX_HEIGHT}
      aria-valuemax={hardCap}
      aria-valuenow={value}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{ cursor: 'ns-resize', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      // A full-width bar read as an empty progress bar; a short grip reads as a handle.
      className="group flex h-2.5 w-full shrink-0 items-center justify-center outline-none"
    >
      <span
        className={cn(
          'h-1 w-10 rounded-full bg-white/15 transition-colors',
          'group-hover:bg-white/35 group-focus-visible:bg-white/50 group-active:bg-white/50'
        )}
      />
    </div>
  )
}
