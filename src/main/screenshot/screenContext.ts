import { randomUUID } from 'node:crypto'
import { captureActiveDisplay, capturePrimaryDisplay } from './capture.js'
import { runOcr } from './ocrPipeline.js'
import type { ScreenSnapshot } from '../../shared/types.js'

/** @deprecated use ScreenSnapshot from shared/types — kept for old imports. */
export interface ScreenContext {
  dataUrl: string
  ocrText: string | null
}

/**
 * Single-shot capture-and-OCR. The OCR result is awaited before returning, so
 * the caller waits ~2-3 s on the first Tesseract bootstrap. Retained for any
 * caller that genuinely wants the text inline; the overlay/chat now prefer the
 * instant-image path below (see {@link captureInstant}).
 *
 * Captures the **primary** display to preserve the original behavior of
 * existing callers — the active-display variant is exposed via captureInstant.
 */
export async function captureWithOcr(): Promise<ScreenContext | null> {
  const dataUrl = await capturePrimaryDisplay()
  if (!dataUrl) return null
  const ocrText = await runOcr(dataUrl)
  return { dataUrl, ocrText }
}

/**
 * Instant capture of the active (under-cursor) display. The image comes back
 * immediately with `ocrText: null`; OCR runs in the background and is delivered
 * to `onOcr` keyed by the same `snapshotId` once Tesseract finishes. This keeps
 * the hotkey feeling instant — the user sees the screenshot at once and the OCR
 * hint folds in a beat later.
 *
 * `onOcr` is best-effort and always fires exactly once per successful capture
 * (with `null` text on OCR failure), so the renderer can clear any "OCR
 * pending" affordance regardless of outcome.
 */
export async function captureInstant(
  onOcr: (snapshotId: string, ocrText: string | null) => void
): Promise<ScreenSnapshot | null> {
  const dataUrl = await captureActiveDisplay()
  if (!dataUrl) return null
  const snapshotId = randomUUID()
  // Fire-and-forget OCR — never block the image delivery on it.
  void runOcr(dataUrl)
    .then((ocrText) => onOcr(snapshotId, ocrText))
    .catch(() => onOcr(snapshotId, null))
  return { snapshotId, dataUrl, ocrText: null }
}
