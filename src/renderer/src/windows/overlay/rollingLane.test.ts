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
  it('returns empty lane for empty finals', () => {
    expect(buildLane({ finals: [] })).toEqual([])
  })

  it('maps finals to items, tagging channel and live=false', () => {
    const out = buildLane({ finals: [seg('a', 'one', 'mic'), seg('b', 'two', 'system')] })
    expect(out).toEqual([
      { id: 'a', text: 'one', channel: 'mic', live: false },
      { id: 'b', text: 'two', channel: 'system', live: false }
    ])
  })

  it('keeps both channels (no longer system-only)', () => {
    const out = buildLane({ finals: [seg('m', 'mic-line', 'mic'), seg('s', 'sys-line', 'system')] })
    expect(out.map((x) => x.text)).toEqual(['mic-line', 'sys-line'])
  })

  it('appends live partials after the finals, marked live=true', () => {
    const out = buildLane({
      finals: [seg('s1', 'final', 'system')],
      partials: {
        mic: seg('p-mic', 'draft-you', 'mic', false),
        system: null
      }
    })
    expect(out).toEqual([
      { id: 's1', text: 'final', channel: 'system', live: false },
      { id: 'p-mic', text: 'draft-you', channel: 'mic', live: true }
    ])
  })

  it('ignores blank / whitespace-only partials', () => {
    const out = buildLane({
      finals: [seg('s1', 'final', 'system')],
      partials: {
        mic: seg('p-mic', '   ', 'mic', false),
        system: null
      }
    })
    expect(out.map((x) => x.id)).toEqual(['s1'])
  })

  it('truncates to the last `limit` items, partials included', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({
      finals,
      partials: { mic: seg('p', 'live', 'mic', false) },
      limit: 3
    })
    expect(out.map((x) => x.id)).toEqual(['f8', 'f9', 'p'])
  })
})
