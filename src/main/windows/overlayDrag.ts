import { screen, type BrowserWindow } from 'electron'
import { clampOverlayPosition, type Point } from './overlayBounds.js'

export const DRAG_TICK_MS = 16
export const DRAG_MAX_MS = 30_000

let stopCurrent: (() => void) | null = null

export function stopOverlayDrag(): void {
  stopCurrent?.()
}

/**
 * Follows the cursor with the window until stopped. The renderer's mouseup is
 * not reliable once the window moves under the cursor or loses focus, so main
 * also stops on blur, hide, destroy and after a hard cap.
 */
export function startOverlayDrag(win: BrowserWindow, onStop: (position: Point) => void): void {
  stopOverlayDrag()
  const cursor = screen.getCursorScreenPoint()
  const [winX = 0, winY = 0] = win.getPosition()
  const grabX = cursor.x - winX
  const grabY = cursor.y - winY
  let last = { x: winX, y: winY }

  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      stop()
      return
    }
    const now = screen.getCursorScreenPoint()
    const [width = 0] = win.getSize()
    const workAreas = screen.getAllDisplays().map((d) => d.workArea)
    const next = clampOverlayPosition({ x: now.x - grabX, y: now.y - grabY }, width, workAreas)
    const target = { x: Math.round(next.x), y: Math.round(next.y) }
    if (target.x === last.x && target.y === last.y) return
    last = target
    win.setPosition(target.x, target.y)
  }, DRAG_TICK_MS)
  const cap = setTimeout(() => stop(), DRAG_MAX_MS)

  function stop(): void {
    if (stopCurrent !== stop) return
    stopCurrent = null
    clearInterval(timer)
    clearTimeout(cap)
    if (win.isDestroyed()) return
    win.off('blur', stop)
    win.off('hide', stop)
    win.off('closed', stop)
    const [x = 0, y = 0] = win.getPosition()
    onStop({ x, y })
  }

  stopCurrent = stop
  win.on('blur', stop)
  win.on('hide', stop)
  win.on('closed', stop)
}
