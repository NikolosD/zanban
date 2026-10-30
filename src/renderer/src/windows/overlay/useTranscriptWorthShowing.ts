import { useEffect, useState } from 'react'
import { findQuestion, lastSystemFinal } from '@shared/questions'
import { useAi } from '@renderer/features/ai/store'
import { useTranscript } from '@renderer/features/transcript/store'

export const TRANSCRIPT_HOLD_MS = 4000

function questionAwaitingAnswer(): string | null {
  const last = lastSystemFinal(useTranscript.getState().finals)
  const fresh = last !== undefined && Date.now() - last.createdAt < TRANSCRIPT_HOLD_MS
  return fresh && findQuestion(last.text) !== null ? last.id : null
}

/**
 * True for a few seconds after the other side finishes a sentence, and for as
 * long as a question they asked has no answer started. Between those moments
 * the transcript is recognizer noise that only takes room from the answer.
 */
export function useTranscriptWorthShowing(): boolean {
  const heard = useTranscript((s) => lastSystemFinal(s.finals))
  const [expiredId, setExpiredId] = useState<string | null>(() => {
    const last = lastSystemFinal(useTranscript.getState().finals)
    return last && Date.now() - last.createdAt >= TRANSCRIPT_HOLD_MS ? last.id : null
  })
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(questionAwaitingAnswer)

  useEffect(() => {
    if (!heard) return
    const left = Math.min(TRANSCRIPT_HOLD_MS, TRANSCRIPT_HOLD_MS - (Date.now() - heard.createdAt))
    const timer = setTimeout(() => setExpiredId(heard.id), Math.max(0, left))
    return () => clearTimeout(timer)
  }, [heard])

  useEffect(() => {
    const offTranscript = useTranscript.subscribe((s, prev) => {
      const last = lastSystemFinal(s.finals)
      if (last === lastSystemFinal(prev.finals)) return
      setOpenQuestionId(last && findQuestion(last.text) !== null ? last.id : null)
    })
    const offAi = useAi.subscribe((s, prev) => {
      if (s.messages.length > prev.messages.length) setOpenQuestionId(null)
    })
    return () => {
      offTranscript()
      offAi()
    }
  }, [])

  return openQuestionId !== null || (heard !== undefined && heard.id !== expiredId)
}
