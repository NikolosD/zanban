import { describe, it, expect } from 'vitest'
import { decideAnswerAction } from './handleAnswer'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'

const q = (
  id: string,
  text: string,
  status: DetectedQuestion['status'] = 'pending'
): DetectedQuestion => ({
  id,
  text,
  detectedAt: Date.now(),
  status
})

describe('decideAnswerAction', () => {
  it('returns "fallback" when autoDetectQuestions is false', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'What is React?')],
      autoDetectQuestions: false
    })
    expect(action).toEqual({
      kind: 'fallback',
      prompt: ANSWER_LAST_PROMPT,
      waitForTranscript: true
    })
  })

  it('returns "fallback" when there are no pending questions', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'old?', 'answered'), q('2', 'dropped?', 'dismissed')],
      autoDetectQuestions: true
    })
    expect(action).toEqual({
      kind: 'fallback',
      prompt: ANSWER_LAST_PROMPT,
      waitForTranscript: true
    })
  })

  it('returns "fallback" on empty store', () => {
    const action = decideAnswerAction({ questions: [], autoDetectQuestions: true })
    expect(action.kind).toBe('fallback')
  })

  it('returns "answerDetected" with the latest pending question', () => {
    const action = decideAnswerAction({
      questions: [
        q('1', 'first?'),
        q('2', 'second?', 'answered'),
        q('3', 'third?'),
        q('4', 'latest?')
      ],
      autoDetectQuestions: true
    })
    expect(action).toEqual({
      kind: 'answerDetected',
      questionId: '4',
      questionText: 'latest?'
    })
  })

  it('treats undefined autoDetectQuestions as enabled (default)', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'go?')],
      autoDetectQuestions: undefined
    })
    expect(action.kind).toBe('answerDetected')
  })
})
