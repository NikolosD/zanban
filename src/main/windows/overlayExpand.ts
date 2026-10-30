import { screen, type BrowserWindow } from 'electron'
import { clampOverlayTop, expandedOverlayBounds, fitOverlayHeight } from './overlayHeight.js'

export interface OverlayExpansion {
  isExpanded(): boolean
  set(win: BrowserWindow, expanded: boolean): void
}

/**
 * Grows the overlay to the work-area height of its display and puts it back.
 * Only top and height change, so width, stealth, content protection and
 * always-on-top are untouched; a width changed meanwhile is kept on restore,
 * and the saved top and height are re-fitted to the display it is on then.
 */
export function createOverlayExpansion(): OverlayExpansion {
  let restore: { y: number; height: number } | null = null

  return {
    isExpanded: () => restore !== null,
    set(win, expanded) {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      if (expanded && !restore) {
        restore = { y: bounds.y, height: bounds.height }
        const { workArea } = screen.getDisplayMatching(bounds)
        win.setBounds({ ...bounds, ...expandedOverlayBounds(workArea) })
      } else if (!expanded && restore) {
        const previous = restore
        restore = null
        const { workArea } = screen.getDisplayMatching(bounds)
        const y = clampOverlayTop(previous.y, workArea)
        win.setBounds({ ...bounds, y, height: fitOverlayHeight(previous.height, y, workArea) })
      }
    }
  }
}
