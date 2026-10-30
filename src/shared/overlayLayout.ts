export const MIN_OVERLAY_WIDTH = 420
export const MAX_OVERLAY_WIDTH = 1100

/** Overlay window width kept between the minimum and the narrower of the maximum and the display. */
export function clampOverlayWidth(requested: number, displayWidth: number): number {
  const max = Math.max(MIN_OVERLAY_WIDTH, Math.min(MAX_OVERLAY_WIDTH, displayWidth))
  return Math.round(Math.max(MIN_OVERLAY_WIDTH, Math.min(max, requested)))
}
