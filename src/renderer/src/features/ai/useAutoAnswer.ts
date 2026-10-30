import { useEffect, useRef } from 'react'
import { findQuestion, questionKey, systemSpeechSince } from '@shared/questions'
import { useTranscript } from '@renderer/features/transcript/store'
import { useAi } from './store'

export const AUTO_ANSWER_SILENCE_MS = 1200

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
 */
export function useAutoAnswer({ enabled, busy, ask }: AutoAnswerOptions): void {
  const busyRef = useRef(busy)
  const askRef = useRef(ask)
  useEffect(() => {
    busyRef.current = busy
    askRef.current = ask
  })
  const asked = useRef<{ sessionId: string | null; keys: Set<string> }>({
    sessionId: null,
    keys: new Set()
  })
  const sessionId = useTranscript((s) =>
    s.session.kind === 'running' ? s.session.sessionId : null
  )

  useEffect(() => {
    if (!enabled || !sessionId) return
    if (asked.current.sessionId !== sessionId) asked.current = { sessionId, keys: new Set() }
    const { keys } = asked.current
    // Whatever was said before auto-answer was switched on is not judged when
    // the next sound arrives.
    let judgedId = systemSpeechSince(useTranscript.getState().finals, null)?.lastId ?? null
    let timer: ReturnType<typeof setTimeout> | undefined

    function settle(): void {
      const speech = systemSpeechSince(useTranscript.getState().finals, judgedId)
      if (!speech) return
      judgedId = speech.lastId
      const question = findQuestion(speech.text)
      if (!question) return
      const key = questionKey(question)
      if (keys.has(key)) return
      if (busyRef.current || useAi.getState().messages.at(-1)?.status === 'streaming') return
      keys.add(key)
      askRef.current(question)
    }

    const unsubscribe = useTranscript.subscribe((s, prev) => {
      const last = s.finals.at(-1)
      const heard =
        s.partials.system !== prev.partials.system ||
        (last !== prev.finals.at(-1) && last?.channel === 'system')
      if (!heard) return
      clearTimeout(timer)
      timer = setTimeout(settle, AUTO_ANSWER_SILENCE_MS)
    })

    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [enabled, sessionId])
}
