import type { AudioChannel, TranscriptSegment } from '@shared/types'

export interface LaneItem {
  id: string
  text: string
  /** Which speaker produced this — drives the "You" vs "Them" styling. */
  channel: AudioChannel
  /** True for the live (non-final) partial that's still being recognized. */
  live: boolean
}

export interface BuildLaneArgs {
  /** Finals from BOTH channels, in chronological order. */
  finals: TranscriptSegment[]
  /** Live (non-final) partials per channel; appended dimmed after the finals. */
  partials?: Partial<Record<AudioChannel, TranscriptSegment | null>>
  /** Last N items to keep; older items are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

/**
 * Build the rolling-transcript lane shown in the overlay HUD.
 *
 * Both channels are interleaved by recency: finals first (chronological), then
 * the live partials appended so the line keeps updating smoothly instead of
 * jumping only when a segment finalizes. The whole lane is trimmed to `limit`
 * so a long call doesn't grow the DOM unboundedly — the freshest text wins.
 */
export function buildLane({ finals, partials, limit = DEFAULT_LIMIT }: BuildLaneArgs): LaneItem[] {
  const items: LaneItem[] = finals.map((seg) => ({
    id: seg.id,
    text: seg.text,
    channel: seg.channel,
    live: false
  }))

  if (partials) {
    for (const seg of Object.values(partials)) {
      // Skip null/empty partials so we don't render a stray cursor on a blank
      // channel that hasn't spoken yet.
      if (seg && seg.text.trim().length > 0) {
        items.push({ id: seg.id, text: seg.text, channel: seg.channel, live: true })
      }
    }
  }

  return items.slice(-limit)
}
