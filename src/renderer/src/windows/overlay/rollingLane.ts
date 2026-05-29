import type { TranscriptSegment } from '@shared/types'

export interface LaneItem {
  id: string
  text: string
}

export interface BuildLaneArgs {
  /** System-channel finals, in chronological order. Caller filters by channel. */
  finals: TranscriptSegment[]
  /** Last N finals to keep; older finals are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

export function buildLane({ finals, limit = DEFAULT_LIMIT }: BuildLaneArgs): LaneItem[] {
  return finals.slice(-limit).map((seg) => ({ id: seg.id, text: seg.text }))
}
