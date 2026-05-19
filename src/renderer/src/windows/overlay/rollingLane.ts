import type { TranscriptSegment } from '@shared/types'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'

export interface LaneItem {
  id: string
  text: string
  isFinal: boolean
  highlight: 'none' | 'pending' | 'resolved'
}

export interface BuildLaneArgs {
  /** System-channel finals, in chronological order. Caller filters by channel. */
  finals: TranscriptSegment[]
  /** Current system-channel partial, or null. */
  partial: TranscriptSegment | null
  questions: DetectedQuestion[]
  /** When false, the questions store is ignored — every item is 'none'. */
  autoDetectQuestions: boolean
  /** Last N finals to keep; older finals are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

export function buildLane({
  finals,
  partial,
  questions,
  autoDetectQuestions,
  limit = DEFAULT_LIMIT
}: BuildLaneArgs): LaneItem[] {
  const byId = new Map<string, DetectedQuestion>()
  if (autoDetectQuestions) {
    for (const q of questions) byId.set(q.id, q)
  }

  const tail = finals.slice(-limit)
  const out: LaneItem[] = tail.map((seg) => {
    const matched = byId.get(seg.id)
    let highlight: LaneItem['highlight'] = 'none'
    if (matched) {
      highlight = matched.status === 'pending' ? 'pending' : 'resolved'
    }
    return { id: seg.id, text: seg.text, isFinal: true, highlight }
  })

  if (partial && partial.text.trim().length > 0) {
    out.push({
      id: `${partial.id}-p`,
      text: partial.text,
      isFinal: false,
      highlight: 'none'
    })
  }

  return out
}
