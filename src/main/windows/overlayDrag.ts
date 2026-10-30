import { screen, type BrowserWindow } from 'electron'
import { clampOverlayPosition, type Point } from './overlayBounds.js'
import { fitOverlayHeight } from './overlayHeight.js'

export const DRAG_TICK_MS = 16
export const DRAG_MAX_MS = 30_000

let stopCurrent: (() => void) | null = null
let setCurrentHeight: ((height: number) => void) | null = null

/** Content grew or shrank mid-drag; the loop must stop re-applying the old height. */
export function updateOverlayDragHeight(height: number): void {
  setCurrentHeight?.(height)
}

export function stopOverlayDrag(): void {
  stopCurrent?.()
}

function refitHeight(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const { workArea } = screen.getDisplayMatching(bounds)
  const [curW = 0, curH = 0] = win.getContentSize()
  const next = fitOverlayHeight(curH, bounds.y, workArea)
  if (next !== curH) win.setContentSize(curW, next, false)
}

/**
 * Follows the cursor with the window until stopped. The renderer's mouseup is
 * not reliable once the window moves under the cursor or loses focus, so main
 * also stops on blur, hide, destroy and after a hard cap. The size captured at
 * the start is re-applied every tick (the height follows content via
 * updateOverlayDragHeight) because setPosition alone can change the
 * size when the window crosses monitors of different scale factors.
 */
export function startOverlayDrag(win: BrowserWindow, onStop: (position: Point) => void): void {
  stopOverlayDrag()
  const cursor = screen.getCursorScreenPoint()
  const [winX = 0, winY = 0] = win.getPosition()
  const [width = 0, startHeight = 0] = win.getSize()
  let height = startHeight
  const grabX = cursor.x - winX
  const grabY = cursor.y - winY
  let last = { x: winX, y: winY }

  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      stop()
      return
    }
    const now = screen.getCursorScreenPoint()
    const workAreas = screen.getAllDisplays().map((d) => d.workArea)
    const next = clampOverlayPosition({ x: now.x - grabX, y: now.y - grabY }, width, workAreas)
    const target = { x: Math.round(next.x), y: Math.round(next.y) }
    if (target.x === last.x && target.y === last.y) return
    last = target
    win.setBounds({ ...target, width, height })
  }, DRAG_TICK_MS)
  const cap = setTimeout(() => stop(), DRAG_MAX_MS)

  function stop(): void {
    if (stopCurrent !== stop) return
    stopCurrent = null
    setCurrentHeight = null
    clearInterval(timer)
    clearTimeout(cap)
    if (win.isDestroyed()) return
    win.off('blur', stop)
    win.off('hide', stop)
    win.off('closed', stop)
    const [x = 0, y = 0] = win.getPosition()
    if (x === winX && y === winY) return
    refitHeight(win)
    onStop({ x, y })
  }

  stopCurrent = stop
  setCurrentHeight = (next) => {
    height = next
  }
  win.on('blur', stop)
  win.on('hide', stop)
  win.on('closed', stop)
}
