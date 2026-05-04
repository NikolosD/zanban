import { desktopCapturer, screen } from 'electron'

/**
 * Capture the primary display and return a base64 PNG data URL. The image
 * is downscaled so the long edge is at most 1280 px — large enough to read
 * UI text reliably, small enough to keep payloads under ~1 MB which keeps
 * the AI gateway round-trip snappy.
 *
 * Returns null if no source could be obtained (rare, but can happen on
 * Windows when display configuration changes mid-call).
 */
export async function capturePrimaryDisplay(): Promise<string | null> {
  const display = screen.getPrimaryDisplay()
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
  const primary =
    sources.find((s) => Number(s.display_id) === display.id) ?? sources[0]
  if (!primary) return null
  const image = primary.thumbnail
  if (image.isEmpty()) return null
  return image.toDataURL()
}
