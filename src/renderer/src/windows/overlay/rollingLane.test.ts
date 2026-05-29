import { describe, it, expect } from 'vitest'
import type { TranscriptSegment } from '@shared/types'
import { buildLane } from './rollingLane'

const seg = (
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment => ({
  id,
  channel,
  speaker: 0,
  startMs: 0,
  endMs: 0,
  text,
  isFinal: true,
  createdAt: 0
})

describe('buildLane', () => {
  it('returns empty lane for empty finals', () => {
    expect(buildLane({ finals: [] })).toEqual([])
  })

  it('maps finals to items', () => {
    const out = buildLane({ finals: [seg('a', 'one'), seg('b', 'two')] })
    expect(out).toEqual([
      { id: 'a', text: 'one' },
      { id: 'b', text: 'two' }
    ])
  })

  it('truncates to the last `limit` finals', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({ finals, limit: 3 })
    expect(out.map((x) => x.id)).toEqual(['f7', 'f8', 'f9'])
  })
})
