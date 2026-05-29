import type { TranscriptSegment } from '@shared/types'

export interface LaneItem {
  id: string
  text: string
  isFinal: boolean
}

export interface BuildLaneArgs {
  /** System-channel finals, in chronological order. Caller filters by channel. */
  finals: TranscriptSegment[]
  /** Current system-channel partial, or null. */
  partial: TranscriptSegment | null
  /** Last N finals to keep; older finals are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

export function buildLane({ finals, partial, limit = DEFAULT_LIMIT }: BuildLaneArgs): LaneItem[] {
  const out: LaneItem[] = finals.slice(-limit).map((seg) => ({
    id: seg.id,
    text: seg.text,
    isFinal: true
  }))

  if (partial && partial.text.trim().length > 0) {
    out.push({ id: `${partial.id}-p`, text: partial.text, isFinal: false })
  }

  return out
}
