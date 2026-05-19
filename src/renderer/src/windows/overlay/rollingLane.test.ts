import { describe, it, expect } from 'vitest'
import type { TranscriptSegment } from '@shared/types'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
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

const q = (
  id: string,
  text: string,
  status: DetectedQuestion['status'] = 'pending'
): DetectedQuestion => ({
  id,
  text,
  detectedAt: 0,
  status
})

describe('buildLane', () => {
  it('returns empty lane for empty inputs', () => {
    expect(
      buildLane({
        finals: [],
        partial: null,
        questions: [],
        autoDetectQuestions: true
      })
    ).toEqual([])
  })

  it('maps finals to non-highlighted items by default', () => {
    const out = buildLane({
      finals: [seg('a', 'one'), seg('b', 'two')],
      partial: null,
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toEqual([
      { id: 'a', text: 'one', isFinal: true, highlight: 'none' },
      { id: 'b', text: 'two', isFinal: true, highlight: 'none' }
    ])
  })

  it('marks a final as pending when a matching question is pending', () => {
    const out = buildLane({
      finals: [seg('a', 'tell me about react?')],
      partial: null,
      questions: [q('a', 'tell me about react?', 'pending')],
      autoDetectQuestions: true
    })
    expect(out[0]!.highlight).toBe('pending')
  })

  it('marks a final as resolved when the matching question is answered', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'answered')],
      autoDetectQuestions: true
    })
    expect(out[0]!.highlight).toBe('resolved')
  })

  it('marks a final as resolved when the matching question is dismissed', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'dismissed')],
      autoDetectQuestions: true
    })
    expect(out[0]!.highlight).toBe('resolved')
  })

  it('ignores question store entirely when autoDetectQuestions is false', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'pending')],
      autoDetectQuestions: false
    })
    expect(out[0]!.highlight).toBe('none')
  })

  it('appends a non-final tail item for a non-empty partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', 'still going', 'system', false),
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({
      id: 'p1-p',
      text: 'still going',
      isFinal: false,
      highlight: 'none'
    })
  })

  it('drops a whitespace-only partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', '   ', 'system', false),
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toHaveLength(1)
  })

  it('truncates to the last `limit` finals but always keeps the partial', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({
      finals,
      partial: seg('p', 'tail', 'system', false),
      questions: [],
      autoDetectQuestions: true,
      limit: 3
    })
    expect(out.map((x) => x.id)).toEqual(['f7', 'f8', 'f9', 'p-p'])
  })

  it('only highlights segments whose ids match a question', () => {
    const out = buildLane({
      finals: [seg('a', 'no match'), seg('b', 'has match')],
      partial: null,
      questions: [q('b', 'has match', 'pending')],
      autoDetectQuestions: true
    })
    expect(out[0]!.highlight).toBe('none')
    expect(out[1]!.highlight).toBe('pending')
  })
})
