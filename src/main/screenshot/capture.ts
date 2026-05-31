import { desktopCapturer, screen } from 'electron'
import type { Display } from 'electron'

/**
 * Capture a single display and return a base64 PNG data URL. The image is
 * downscaled so the long edge is at most 1280 px — large enough to read UI
 * text reliably, small enough to keep payloads under ~1 MB which keeps the AI
 * gateway round-trip snappy.
 *
 * Returns null if no source could be obtained (rare, but can happen on Windows
 * when display configuration changes mid-call).
 */
export async function captureDisplay(display: Display): Promise<string | null> {
  const { width, height } = display.size
  const scale = Math.min(1, 1280 / Math.max(width, height))
  const thumbnailSize = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  })
  if (sources.length === 0) return null
  const match = sources.find((s) => Number(s.display_id) === display.id) ?? sources[0]
  if (!match) return null
  const image = match.thumbnail
  if (image.isEmpty()) return null
  return image.toDataURL()
}

/**
 * Capture the display currently under the cursor. On a multi-monitor setup
 * this is the screen the user is actually looking at — the interview case where
 * the problem is on one screen and the call on the other.
 */
export async function captureActiveDisplay(): Promise<string | null> {
  return captureDisplay(getActiveDisplay())
}

/** The display under the cursor, falling back to the primary. */
export function getActiveDisplay(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/**
 * Back-compat: capture the primary display. Retained for any caller that wants
 * the primary specifically rather than the active one.
 */
export async function capturePrimaryDisplay(): Promise<string | null> {
  return captureDisplay(screen.getPrimaryDisplay())
}
