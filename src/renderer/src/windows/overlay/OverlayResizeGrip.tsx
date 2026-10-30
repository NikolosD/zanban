import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_SETTINGS } from '@shared/types'
import { clampOverlayWidth } from '@shared/overlayLayout'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  DEFAULT_ANSWER_MAX_HEIGHT,
  MIN_ANSWER_MAX_HEIGHT,
  clampAnswerHeight
} from './answerPaneResize'

const KEY_STEP = 20
const KEY_STEP_LARGE = 80

interface Props {
  /** Current answer-pane max-height in px. Controlled. */
  answerHeight: number
  /** Runtime ceiling for the answer pane derived from screen.availHeight. */
  hardCap: number
  /** Fires live during a drag with the proposed (already clamped) values. */
  onWidthChange: (next: number) => void
  onHeightChange: (next: number) => void
  /** Fires once per gesture (mouseup, dblclick, key press) if the value actually changed. */
  onWidthCommit: (next: number) => void
  onHeightCommit: (next: number) => void
}

function currentWidth(): number {
  return window.innerWidth
}

function clampWidth(requested: number): number {
  return clampOverlayWidth(requested, window.screen.availWidth)
}

/**
 * Bottom-right corner handle. Horizontal drag changes the overlay window's
 * width (its left edge stays put); vertical drag changes the answer pane's
 * max-height. The window's own height follows the content, so there is no
 * second axis to resize. Arrow keys: Left/Right width, Up/Down height, Shift
 * for bigger steps, Home/End for the height extremes. Double-click resets both.
 */
export function OverlayResizeGrip({
  answerHeight,
  hardCap,
  onWidthChange,
  onHeightChange,
  onWidthCommit,
  onHeightCommit
}: Props) {
  const { t } = useTranslation()
  // Each drag is computed against where it began, not the last intermediate
  // value, so rounding does not compound.
  const gesture = useRef<{
    x: number
    y: number
    width: number
    height: number
    nextWidth: number
    nextHeight: number
  } | null>(null)
  const dragListeners = useRef<AbortController | null>(null)

  const endDrag = useCallback(() => {
    dragListeners.current?.abort()
    dragListeners.current = null
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.nextWidth !== g.width) onWidthCommit(g.nextWidth)
    if (g.nextHeight !== g.height) onHeightCommit(g.nextHeight)
  }, [onWidthCommit, onHeightCommit])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || gesture.current) return
    e.preventDefault()
    const width = currentWidth()
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      width,
      height: answerHeight,
      nextWidth: width,
      nextHeight: answerHeight
    }
    dragListeners.current = new AbortController()
    const { signal } = dragListeners.current
    document.addEventListener(
      'mousemove',
      (move: MouseEvent) => {
        const g = gesture.current
        if (!g) return
        const nextWidth = clampWidth(g.width + move.clientX - g.x)
        const nextHeight = clampAnswerHeight(g.height + move.clientY - g.y, hardCap)
        if (nextWidth !== g.nextWidth) onWidthChange(nextWidth)
        if (nextHeight !== g.nextHeight) onHeightChange(nextHeight)
        g.nextWidth = nextWidth
        g.nextHeight = nextHeight
      },
      { signal }
    )
    document.addEventListener('mouseup', endDrag, { signal })
  }

  const onDoubleClick = () => {
    const width = DEFAULT_SETTINGS.overlayWidth
    if (currentWidth() !== width) {
      onWidthChange(width)
      onWidthCommit(width)
    }
    if (answerHeight !== DEFAULT_ANSWER_MAX_HEIGHT) {
      onHeightChange(DEFAULT_ANSWER_MAX_HEIGHT)
      onHeightCommit(DEFAULT_ANSWER_MAX_HEIGHT)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const width = currentWidth()
      const next = clampWidth(width + (e.key === 'ArrowRight' ? step : -step))
      if (next === width) return
      onWidthChange(next)
      onWidthCommit(next)
      return
    }
    let next: number
    if (e.key === 'ArrowDown') next = answerHeight + step
    else if (e.key === 'ArrowUp') next = answerHeight - step
    else if (e.key === 'Home') next = MIN_ANSWER_MAX_HEIGHT
    else if (e.key === 'End') next = hardCap
    else return
    e.preventDefault()
    next = clampAnswerHeight(next, hardCap)
    if (next === answerHeight) return
    onHeightChange(next)
    onHeightCommit(next)
  }

  useEffect(() => () => dragListeners.current?.abort(), [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid="overlay-resize-grip"
          data-interactive
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('overlay.resize_overlay')}
          aria-valuemin={MIN_ANSWER_MAX_HEIGHT}
          aria-valuemax={hardCap}
          aria-valuenow={answerHeight}
          tabIndex={0}
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          style={{ cursor: 'nwse-resize' }}
          className="group absolute bottom-0 right-0 z-10 flex size-3.5 items-end justify-end outline-none"
        >
          <svg
            viewBox="0 0 14 14"
            className="size-3.5 stroke-white/30 transition-colors group-hover:stroke-white/70 group-focus-visible:stroke-white/70 group-active:stroke-white/70"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M11 4 L4 11 M11 8 L8 11" />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent>{t('overlay.resize_overlay_tooltip')}</TooltipContent>
    </Tooltip>
  )
}
