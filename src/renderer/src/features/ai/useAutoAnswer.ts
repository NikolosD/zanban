import { useEffect, useRef } from 'react'
import {
  endsWithQuestionMark,
  findQuestion,
  lastSystemFinal,
  questionKey,
  systemSpeechSince
} from '@shared/questions'
import { useTranscript } from '@renderer/features/transcript/store'
import { useAi } from './store'

export const AUTO_ANSWER_SILENCE_MS = 1200
export const AUTO_ANSWER_REPEAT_MS = 90_000

interface AutoAnswerOptions {
  enabled: boolean
  /** An ask is being dispatched; asking now would be dropped. */
  busy: boolean
  ask(question: string): void
}

/**
 * Asks once the other side has gone quiet after a question. A question that
 * ends while an answer is still on its way is skipped, not queued: the user is
 * reading that answer, and a card swapped in late answers a moment that passed.
 * A question with no closing punctuation waits a second silence first, since the
 * recognizer may only have caught its first half.
 */
export function useAutoAnswer({ enabled, busy, ask }: AutoAnswerOptions): void {
  const busyRef = useRef(busy)
  const askRef = useRef(ask)
  useEffect(() => {
    busyRef.current = busy
    askRef.current = ask
  })
  const asked = useRef<{ sessionId: string | null; at: Map<string, number> }>({
    sessionId: null,
    at: new Map()
  })
  const sessionId = useTranscript((s) =>
    s.session.kind === 'running' ? s.session.sessionId : null
  )

  useEffect(() => {
    if (!enabled || !sessionId) return
    if (asked.current.sessionId !== sessionId) asked.current = { sessionId, at: new Map() }
    const { at } = asked.current
    // Whatever was said before auto-answer was switched on is not judged when
    // the next sound arrives.
    let judgedId = lastSystemFinal(useTranscript.getState().finals)?.id ?? null
    let lastMessageId = useAi.getState().messages.at(-1)?.id
    let timer: ReturnType<typeof setTimeout> | undefined

    function repeatedRecently(key: string): boolean {
      const askedAt = at.get(key)
      if (askedAt === undefined || Date.now() - askedAt >= AUTO_ANSWER_REPEAT_MS) return false
      const answer = useAi
        .getState()
        .messages.filter((m) => m.question && questionKey(m.question) === key)
        .at(-1)
      return answer?.status !== 'error'
    }

    function settle(waited: boolean): void {
      const speech = systemSpeechSince(useTranscript.getState().finals, judgedId)
      if (!speech) return
      const question = findQuestion(speech.text)
      if (question && !endsWithQuestionMark(question) && !waited) {
        timer = setTimeout(() => settle(true), AUTO_ANSWER_SILENCE_MS)
        return
      }
      judgedId = speech.lastId
      if (!question) return
      const key = questionKey(question)
      if (repeatedRecently(key)) return
      if (busyRef.current || useAi.getState().messages.at(-1)?.status === 'streaming') return
      at.set(key, Date.now())
      askRef.current(question)
    }

    const unsubscribeTranscript = useTranscript.subscribe((s, prev) => {
      const last = s.finals.at(-1)
      const heard =
        s.partials.system !== prev.partials.system ||
        (last !== prev.finals.at(-1) && last?.channel === 'system')
      if (!heard) return
      clearTimeout(timer)
      timer = setTimeout(() => settle(false), AUTO_ANSWER_SILENCE_MS)
    })

    // Someone asked, and that answer covers what has been said so far: a manual
    // Answer that finishes before the silence is up must not be followed by an
    // auto-ask of the same question.
    const unsubscribeAi = useAi.subscribe((s) => {
      const id = s.messages.at(-1)?.id
      if (id === lastMessageId) return
      lastMessageId = id
      judgedId = lastSystemFinal(useTranscript.getState().finals)?.id ?? judgedId
    })

    return () => {
      unsubscribeTranscript()
      unsubscribeAi()
      clearTimeout(timer)
    }
  }, [enabled, sessionId])
}
