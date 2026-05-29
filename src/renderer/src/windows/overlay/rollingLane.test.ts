import { describe, it, expect } from 'vitest'
import type { TranscriptSegment } from '@shared/types'
import { buildLane } from './rollingLane'

const seg = (
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system',
  isFinal = true
): TranscriptSegment => ({
  id,
  channel,
  speaker: 0,
  startMs: 0,
  endMs: 0,
  text,
  isFinal,
  createdAt: 0
})

describe('buildLane', () => {
  it('returns empty lane for empty inputs', () => {
    expect(buildLane({ finals: [], partial: null })).toEqual([])
  })

  it('maps finals to items', () => {
    const out = buildLane({ finals: [seg('a', 'one'), seg('b', 'two')], partial: null })
    expect(out).toEqual([
      { id: 'a', text: 'one', isFinal: true },
      { id: 'b', text: 'two', isFinal: true }
    ])
  })

  it('appends a non-final tail item for a non-empty partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', 'still going', 'system', false)
    })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ id: 'p1-p', text: 'still going', isFinal: false })
  })

  it('drops a whitespace-only partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', '   ', 'system', false)
    })
    expect(out).toHaveLength(1)
  })

  it('truncates to the last `limit` finals but always keeps the partial', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({ finals, partial: seg('p', 'tail', 'system', false), limit: 3 })
    expect(out.map((x) => x.id)).toEqual(['f7', 'f8', 'f9', 'p-p'])
  })
})
