// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'
import type { AudioChannel } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { useAi } from './store'
import { useAskRequest } from './useAskRequest'
import { AUTO_ANSWER_SILENCE_MS, useAutoAnswer } from './useAutoAnswer'

const QUESTION = 'What is your experience with React?'
const NEXT_QUESTION = 'And how long did that project take?'

let nextId = 0

function say(text: string, channel: AudioChannel = 'system', isFinal = true): void {
  act(() => {
    useTranscript.getState().pushSegment({
      id: `seg-${nextId++}`,
      channel,
      speaker: 0,
      startMs: 0,
      endMs: 0,
      text,
      isFinal,
      createdAt: Date.now()
    })
  })
}

function startSession(sessionId = 's1'): void {
  act(() => useTranscript.getState().setSession({ kind: 'running', sessionId, startedAt: 0 }))
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function asksInto() {
  let n = 0
  return vi.fn((question: string) =>
    useAi.getState().newRequest('Answer last question', `r${++n}`, undefined, question)
  )
}

function mountAutoAnswer(ask = vi.fn(), enabled = true) {
  const hook = renderHook((props) => useAutoAnswer(props), {
    initialProps: { enabled, busy: false, ask }
  })
  return { ask, ...hook }
}

beforeEach(() => {
  vi.useFakeTimers()
  useTranscript.setState({
    finals: [],
    partials: { mic: null, system: null },
    session: { kind: 'idle' },
    lastUpdateAt: null,
    lastFinalAt: null
  })
  useAi.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useAutoAnswer', () => {
  it('asks once, after the other side has been quiet', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)

    wait(AUTO_ANSWER_SILENCE_MS - 1)
    expect(ask).not.toHaveBeenCalled()
    wait(1)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(QUESTION)

    wait(30_000)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting while the other side is still talking', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('What is your', 'system', false)
    wait(800)
    say('What is your experience with', 'system', false)
    wait(800)
    expect(ask).not.toHaveBeenCalled()

    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS - 1)
    expect(ask).not.toHaveBeenCalled()
    wait(1)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(QUESTION)
  })

  it('starts the wait over when the other side begins talking again', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(800)
    say('and also', 'system', false)
    wait(AUTO_ANSWER_SILENCE_MS - 1)
    expect(ask).not.toHaveBeenCalled()
    wait(1)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(QUESTION)
  })

  it('reads a question the recognizer split across two segments as one', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Thanks for joining. What would you do')
    wait(500)
    say('if the deploy failed?')
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('What would you do if the deploy failed?')
  })

  it('asks the question in Russian too', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Расскажите, какой у вас опыт работы с React?')

    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledWith('Расскажите, какой у вас опыт работы с React?')
  })

  it('does not answer your own questions, statements, fillers or call check-ins', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION, 'mic')
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    say('Thanks for joining us today.')
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    say('Can you hear me?')
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    say('ok?')
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    say('да?')
    wait(AUTO_ANSWER_SILENCE_MS * 2)

    expect(ask).not.toHaveBeenCalled()
  })

  it('waits for a second silence before answering a question with no closing punctuation', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Why did you choose')

    wait(AUTO_ANSWER_SILENCE_MS * 2 - 1)
    expect(ask).not.toHaveBeenCalled()
    wait(1)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('Why did you choose')
  })

  it('joins what is said in that second silence to the half question', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Why did you choose')
    wait(AUTO_ANSWER_SILENCE_MS + 100)
    say('Postgres over Mongo?')
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('Why did you choose Postgres over Mongo?')
  })

  it('waits only once more for each stretch of speech', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Why did you choose')
    wait(AUTO_ANSWER_SILENCE_MS + 100)
    say('that database over')
    wait(AUTO_ANSWER_SILENCE_MS * 2)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith('Why did you choose that database over')
  })

  it('does not hold back a question that ends in a question mark', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Why did you choose Postgres?')
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not answer the group-call check-ins', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    for (const text of ['Can everyone hear me?', 'Вы нас хорошо слышите?']) {
      say(text)
      wait(AUTO_ANSWER_SILENCE_MS * 2)
    }

    expect(ask).not.toHaveBeenCalled()
  })

  it('is not held up by something you finished saying while it waits', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(600)
    say('Sure, so I would start with', 'mic')
    wait(AUTO_ANSWER_SILENCE_MS - 600 - 1)
    expect(ask).not.toHaveBeenCalled()
    wait(1)

    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not wait on you: only the other side restarts the silence', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(600)
    say('Sure, so', 'mic', false)
    wait(600)

    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('drops a pending question when switched off while it waits', () => {
    const { ask, rerender } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(600)
    rerender({ enabled: false, busy: false, ask })
    wait(AUTO_ANSWER_SILENCE_MS * 3)

    expect(ask).not.toHaveBeenCalled()
  })

  it('drops a pending question when you ask by hand before the silence is up', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(400)
    act(() => useAi.getState().newRequest('Answer last question', 'r1', undefined, QUESTION))
    act(() => useAi.getState().finishRequest('r1', 'stop'))
    wait(AUTO_ANSWER_SILENCE_MS * 3)
    say('mm-hmm', 'system', false)
    wait(AUTO_ANSWER_SILENCE_MS * 3)

    expect(ask).not.toHaveBeenCalled()
  })

  it('still answers a question that ended while the previous answer was finishing', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    act(() => useAi.getState().newRequest('Answer last question', 'r1'))
    say(QUESTION)
    wait(600)
    act(() => useAi.getState().appendChunk('r1', 'The last few words'))
    act(() => useAi.getState().finishRequest('r1', 'stop'))
    wait(AUTO_ANSWER_SILENCE_MS - 600)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(QUESTION)
  })

  it('leaves no listeners behind when switched off', () => {
    const released = vi.fn()
    const subscribe = useAi.subscribe
    vi.spyOn(useAi, 'subscribe').mockImplementation((listener) => {
      const off = subscribe(listener)
      return () => {
        released()
        off()
      }
    })
    const { rerender, ask } = mountAutoAnswer()
    startSession()
    expect(released).not.toHaveBeenCalled()

    rerender({ enabled: false, busy: false, ask })
    expect(released).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('still answers the next question after you asked by hand', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(400)
    act(() => useAi.getState().newRequest('Answer last question', 'r1', undefined, QUESTION))
    act(() => useAi.getState().finishRequest('r1', 'stop'))

    say(NEXT_QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(NEXT_QUESTION)
  })

  it('does nothing while switched off or without a running session', () => {
    const { ask, rerender } = mountAutoAnswer(vi.fn(), false)
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    expect(ask).not.toHaveBeenCalled()

    rerender({ enabled: true, busy: false, ask })
    act(() => useTranscript.getState().setSession({ kind: 'stopping' }))
    say(NEXT_QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    expect(ask).not.toHaveBeenCalled()
  })

  it('drops a pending question when the session ends', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS - 1)
    act(() => useTranscript.getState().setSession({ kind: 'idle' }))
    wait(AUTO_ANSWER_SILENCE_MS * 2)

    expect(ask).not.toHaveBeenCalled()
  })

  it('does not judge what was said before it was switched on', () => {
    const { ask, rerender } = mountAutoAnswer(vi.fn(), false)
    startSession()
    say(QUESTION)
    rerender({ enabled: true, busy: false, ask })
    say('hm', 'system', false)
    wait(AUTO_ANSWER_SILENCE_MS * 2)

    expect(ask).not.toHaveBeenCalled()
  })

  it('never answers the same question twice', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    say('Take your time.')
    wait(AUTO_ANSWER_SILENCE_MS)
    say('so what is your experience with react')
    wait(AUTO_ANSWER_SILENCE_MS * 2)
    expect(ask).toHaveBeenCalledTimes(1)

    say(NEXT_QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenLastCalledWith(NEXT_QUESTION)
  })

  it('asks it again once the other side has had time to forget', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    say('Can you elaborate on that?')
    wait(AUTO_ANSWER_SILENCE_MS)
    wait(60_000)
    say('Can you elaborate on that?')
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(1)

    wait(5 * 60_000)
    say('Can you elaborate on that?')
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('asks it again at once if the first attempt failed', () => {
    const ask = asksInto()
    mountAutoAnswer(ask)
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    act(() => useAi.getState().failRequest('r1', 'network'))

    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('does not ask it again when the first attempt was answered', () => {
    const ask = asksInto()
    mountAutoAnswer(ask)
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    act(() => useAi.getState().finishRequest('r1', 'stop'))

    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('still remembers it after being switched off and on again', () => {
    const { ask, rerender } = mountAutoAnswer()
    startSession()
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)

    rerender({ enabled: false, busy: false, ask })
    rerender({ enabled: true, busy: false, ask })
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('asks the same question again in a new session', () => {
    const { ask } = mountAutoAnswer()
    startSession('s1')
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    startSession('s2')
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('skips a question that ends while an answer is still streaming', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    act(() => useAi.getState().newRequest('Answer last question', 'r1'))
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).not.toHaveBeenCalled()

    act(() => useAi.getState().finishRequest('r1', 'stop'))
    wait(30_000)
    expect(ask).not.toHaveBeenCalled()

    say(NEXT_QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(NEXT_QUESTION)
  })

  it('answers a skipped question if they ask it again once the answer is done', () => {
    const { ask } = mountAutoAnswer()
    startSession()
    act(() => useAi.getState().newRequest('Answer last question', 'r1'))
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    act(() => useAi.getState().finishRequest('r1', 'stop'))

    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('skips a question while another ask is still being dispatched', () => {
    const { ask, rerender } = mountAutoAnswer()
    startSession()
    rerender({ enabled: true, busy: true, ask })
    say(QUESTION)
    wait(AUTO_ANSWER_SILENCE_MS)

    expect(ask).not.toHaveBeenCalled()
  })
})

describe('useAutoAnswer with useAskRequest', () => {
  function mountOverlayAsk() {
    const ai = {
      ask: vi.fn(async ({ requestId }: { requestId: string }) => ({ requestId })),
      stop: vi.fn(async () => {})
    }
    vi.stubGlobal('zanban', { ai })
    const hook = renderHook(() => {
      const request = useAskRequest()
      useAutoAnswer({
        enabled: true,
        busy: request.busy,
        ask: (question) =>
          void request.run({ prompt: ANSWER_LAST_PROMPT, waitForTranscript: true, question })
      })
      return request
    })
    return { ai, ...hook }
  }

  async function settleSilence(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(AUTO_ANSWER_SILENCE_MS)
    })
  }

  it('sends one answer request per detected question and keeps the question on the card', async () => {
    const { ai } = mountOverlayAsk()
    startSession()
    say(QUESTION)
    await settleSilence()
    await settleSilence()

    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.ask.mock.lastCall![0]).toMatchObject({ prompt: ANSWER_LAST_PROMPT })
    const [message] = useAi.getState().messages
    expect(message).toMatchObject({ status: 'streaming', question: QUESTION })
  })

  it('does not interrupt that answer with the next question while it streams', async () => {
    const { ai } = mountOverlayAsk()
    startSession()
    say(QUESTION)
    await settleSilence()

    say(NEXT_QUESTION)
    await settleSilence()

    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(ai.stop).not.toHaveBeenCalled()
    expect(useAi.getState().messages).toHaveLength(1)
  })

  it('does not follow a quick manual Answer with an auto-ask of the same question', async () => {
    const { ai, result } = mountOverlayAsk()
    startSession()
    say(QUESTION)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    await act(async () => {
      void result.current.run({ prompt: ANSWER_LAST_PROMPT, waitForTranscript: true })
      vi.advanceTimersByTime(400)
    })
    expect(ai.ask).toHaveBeenCalledTimes(1)
    act(() => useAi.getState().finishRequest(useAi.getState().messages[0]!.id, 'stop'))

    await settleSilence()
    await settleSilence()
    expect(ai.ask).toHaveBeenCalledTimes(1)
    expect(useAi.getState().messages).toHaveLength(1)
  })

  it('answers the next question once that answer is done', async () => {
    const { ai } = mountOverlayAsk()
    startSession()
    say(QUESTION)
    await settleSilence()
    act(() => useAi.getState().finishRequest(useAi.getState().messages[0]!.id, 'stop'))

    say(NEXT_QUESTION)
    await settleSilence()

    expect(ai.ask).toHaveBeenCalledTimes(2)
    expect(useAi.getState().messages.map((m) => m.question)).toEqual([QUESTION, NEXT_QUESTION])
  })
})
