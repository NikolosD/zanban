interface Area {
  y: number
  height: number
}

const MIN_HEIGHT = 120
const BOTTOM_MARGIN = 24

/**
 * Window height for the overlay's measured content, kept above the bottom of
 * its display's work area. Display coordinates are global: a monitor below or
 * above the primary one starts at a y far from 0.
 */
export function fitOverlayHeight(requested: number, windowY: number, workArea: Area): number {
  const max = Math.max(MIN_HEIGHT, workArea.y + workArea.height - windowY - BOTTOM_MARGIN)
  return Math.max(MIN_HEIGHT, Math.min(max, Math.ceil(requested)))
}
