import { screen, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { handleIpc } from '../ipc/guard.js'
import type { Point } from './overlayBounds.js'
import { startOverlayDrag, stopOverlayDrag, updateOverlayDragHeight } from './overlayDrag.js'
import { createOverlayExpansion } from './overlayExpand.js'
import { fitOverlayHeight } from './overlayHeight.js'

/**
 * Height, expand and drag requests for the overlay window. While a code block
 * is expanded the window is sized by main alone, so content-height and drag
 * requests are ignored until it is restored.
 */
export function registerOverlayWindowIpc(
  getWindow: () => BrowserWindow | null,
  onDragStop: (position: Point) => void
): { watch(win: BrowserWindow): void } {
  const expansion = createOverlayExpansion()

  const liveWindow = (): BrowserWindow | null => {
    const win = getWindow()
    return win && !win.isDestroyed() ? win : null
  }

  // Renderer measures the visible glass panel and asks us to resize the
  // window to match. We clamp to the current display's work area so a long
  // streamed answer never drives the window off-screen — anything beyond the
  // cap falls back to the inner pane scrolling.
  handleIpc(IPC.overlay.setContentHeight, (_e, requested: number) => {
    const win = liveWindow()
    if (!win || expansion.isExpanded()) return
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const next = fitOverlayHeight(requested, bounds.y, display.workArea)
    const [curW = 0, curH = 0] = win.getContentSize()
    if (Math.abs(curH - next) < 2) return
    win.setContentSize(curW, next, false)
    updateOverlayDragHeight(next)
  })

  handleIpc(IPC.overlay.setExpanded, (_e, expanded: boolean) => {
    const win = liveWindow()
    if (!win) return
    // A drag tick would re-apply the pre-expand height.
    if (expanded === true) stopOverlayDrag()
    expansion.set(win, expanded === true)
  })

  handleIpc(IPC.overlay.dragStart, () => {
    const win = liveWindow()
    if (!win || expansion.isExpanded()) return
    startOverlayDrag(win, onDragStop)
  })

  return {
    watch(win) {
      win.on('hide', () => expansion.set(win, false))
    }
  }
}
