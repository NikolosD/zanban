import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'

export type AnswerAction =
  | { kind: 'answerDetected'; questionId: string; questionText: string }
  | { kind: 'fallback'; prompt: string; waitForTranscript: boolean }

interface Input {
  questions: DetectedQuestion[]
  /** Settings flag; `undefined` is treated as enabled (matches the existing default). */
  autoDetectQuestions: boolean | undefined
}

/**
 * Decide what the "Ответить" button should actually do.
 *
 * Default flow ("answer last") used to ship the raw ANSWER_LAST_PROMPT and let
 * the LLM figure out the question from the transcript tail. That tail is often
 * stale at click time (STT has not flushed the final segment yet), so the
 * first click ends up answering the *previous* question. Routing through the
 * detected-questions store gives us the verbatim question text the moment the
 * extractor emitted it, which is far ahead of `awaitTranscriptSettle`.
 *
 * When the detector is disabled or no pending question is in the store, we
 * fall through to the legacy prompt so users who turned off detection are not
 * silently broken.
 */
export function decideAnswerAction({ questions, autoDetectQuestions }: Input): AnswerAction {
  if (autoDetectQuestions === false) {
    return { kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true }
  }
  const latestPending = questions.filter((q) => q.status === 'pending').at(-1)
  if (!latestPending) {
    return { kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true }
  }
  return {
    kind: 'answerDetected',
    questionId: latestPending.id,
    questionText: latestPending.text
  }
}
