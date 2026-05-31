/**
 * Pure geometry helpers for the region cropper. Kept Electron-free so the
 * clamp + DPR-reconciliation math is trivially unit-testable — the native
 * `desktopCapturer` / `nativeImage.crop()` calls around it are not.
 *
 * The cropper renderer reports the selection in **CSS pixels** relative to its
 * own window (which covers one display), tagged with that window's
 * `devicePixelRatio`. The captured source image, however, is rastered at the
 * display's `scaleFactor`. On Windows at 125%/150% scaling those two numbers
 * can disagree (the renderer's devicePixelRatio lags the OS scale, or rounds
 * differently), which shifts the crop versus what the user dragged. We scale
 * the rect by the *source* scale factor and clamp it to the source bounds.
 */

export interface CropRectCss {
  /** Selection in CSS pixels relative to the cropper window's top-left. */
  x: number
  y: number
  w: number
  h: number
  /** The cropper renderer's window.devicePixelRatio at selection time. */
  dpr: number
}

export interface CropRectPx {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert a CSS-pixel selection into a clamped device-pixel crop rect for the
 * captured source image.
 *
 * @param rect     Selection in CSS px + the renderer DPR it was measured at.
 * @param scaleFactor The target display's `scaleFactor` — the scale the source
 *                 image was actually rastered at.
 * @param sourceWidth  Source image width in device px.
 * @param sourceHeight Source image height in device px.
 *
 * Returns a rect whose origin is inside the source and whose extent never runs
 * past the source edge, or null when the clamped selection is empty (zero area
 * after clamping — e.g. a degenerate drag entirely off the captured region).
 */
export function cssRectToCroppedPx(
  rect: CropRectCss,
  scaleFactor: number,
  sourceWidth: number,
  sourceHeight: number
): CropRectPx | null {
  // The renderer measured in CSS px scaled by its own DPR; the source raster
  // uses scaleFactor. Reconcile: CSS px → source device px = css * scaleFactor.
  // (We deliberately ignore rect.dpr for the conversion — the source image is
  // rastered at scaleFactor, so that's the only factor that maps onto it. dpr
  // is kept on the type for callers that want to log/diagnose the mismatch.)
  const scale = scaleFactor > 0 ? scaleFactor : 1
  let x = Math.round(rect.x * scale)
  let y = Math.round(rect.y * scale)
  let w = Math.round(rect.w * scale)
  let h = Math.round(rect.h * scale)

  // Clamp origin into [0, source). A negative origin (selection started off the
  // top/left edge) gets pulled to 0 with its extent shortened to compensate.
  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }

  // Clamp extent so x+w / y+h never exceed the source bounds.
  const maxW = Math.max(0, Math.floor(sourceWidth) - x)
  const maxH = Math.max(0, Math.floor(sourceHeight) - y)
  w = Math.min(w, maxW)
  h = Math.min(h, maxH)

  if (w <= 0 || h <= 0) return null
  return { x, y, width: w, height: h }
}
