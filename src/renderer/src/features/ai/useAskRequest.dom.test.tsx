// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANSWER_LAST_PROMPT, SHORTEN_PROMPT } from '@shared/prompts'
import type { AudioChannel } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { useAi } from './store'
import { useAskRequest } from './useAskRequest'

function stubZanban() {
  const ai = {
    ask: vi.fn(async ({ requestId }: { requestId: string }) => ({ requestId })),
    stop: vi.fn(async () => {})
  }
  vi.stubGlobal('zanban', { ai })
  return ai
}

function hear(id: string, text: string, channel: AudioChannel = 'system'): void {
  useTranscript.getState().pushSegment({
    id,
    channel,
    speaker: 0,
    startMs: 0,
    endMs: 0,
    text,
    isFinal: true,
    createdAt: 0
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAi.getState().reset()
  useTranscript.getState().reset()
})

describe('useAskRequest', () => {
  it('stops an answer still streaming when the next question is asked', async () => {
    const ai = stubZanban()
    const { result } = renderHook(() => useAskRequest())
    await act(() => result.current.run({ prompt: 'first' }))
    const first = useAi.getState().messages[0]!.id
    await act(() => result.current.run({ prompt: 'second' }))

    expect(ai.stop).toHaveBeenCalledWith(first)
    act(() => result.current.stop())
    expect(ai.stop).toHaveBeenLastCalledWith(useAi.getState().messages[1]!.id)
  })

  it('writes a continuation onto the end of the cut answer', async () => {
    const ai = stubZanban()
    const { result } = renderHook(() => useAskRequest())
    await act(() => result.current.run({ prompt: 'explain', label: 'Explain' }))
    const cut = useAi.getState().messages[0]!.id
    act(() => {
      useAi.getState().appendChunk(cut, 'The first half')
      useAi.getState().finishRequest(cut, 'length')
    })
    await act(() => result.current.run({ prompt: 'question' }))
    act(() => useAi.getState().finishRequest(useAi.getState().messages[1]!.id, 'stop'))

    await act(() => result.current.run({ prompt: 'continue', continueFrom: cut }))
    const next = ai.ask.mock.lastCall![0]
    expect(next).toMatchObject({ prompt: 'continue', continueFrom: cut })
    act(() => useAi.getState().appendChunk(next.requestId, ' and the rest.'))

    const messages = useAi.getState().messages
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      id: next.requestId,
      prompt: 'Explain',
      answer: 'The first half and the rest.',
      status: 'streaming'
    })
  })
})

describe('the question an answer is for', () => {
  async function ask(opts: Parameters<ReturnType<typeof useAskRequest>['run']>[0]) {
    stubZanban()
    const { result } = renderHook(() => useAskRequest())
    await act(() => result.current.run(opts))
    return result
  }

  it('is the latest thing the other side said when Answer is pressed', async () => {
    hear('a', 'Thanks for joining.')
    hear('b', 'And what did you ship last quarter?')
    hear('c', 'Let me think.', 'mic')
    await ask({ prompt: ANSWER_LAST_PROMPT, label: 'Answer last question' })

    expect(useAi.getState().messages[0]).toMatchObject({
      prompt: 'Answer last question',
      question: 'And what did you ship last quarter?'
    })
  })

  it('is read when the ask is sent, after the transcript has settled', async () => {
    stubZanban()
    const { result } = renderHook(() => useAskRequest())
    hear('a', 'First thing.')
    useTranscript.getState().setSession({ kind: 'running', sessionId: 's1', startedAt: 0 })
    hear('b', 'Second thing, partly.')
    vi.useFakeTimers()
    try {
      const pending = act(() =>
        result.current.run({ prompt: ANSWER_LAST_PROMPT, waitForTranscript: true })
      )
      hear('c', 'What did you ship?')
      await vi.advanceTimersByTimeAsync(1000)
      await pending
    } finally {
      vi.useRealTimers()
    }

    expect(useAi.getState().messages[0]?.question).toBe('What did you ship?')
  })

  it('is left out when the other side has said nothing', async () => {
    hear('a', 'My own words', 'mic')
    await ask({ prompt: ANSWER_LAST_PROMPT })

    expect(useAi.getState().messages[0]?.question).toBeUndefined()
  })

  it('is left out of typed questions and other prompts', async () => {
    hear('a', 'What did you ship?')
    const result = await ask({ prompt: 'what is our churn?' })
    await act(() => result.current.run({ prompt: SHORTEN_PROMPT }))

    expect(useAi.getState().messages.map((m) => m.question)).toEqual([undefined, undefined])
  })

  it('is the one handed in, not the latest utterance', async () => {
    hear('a', 'Take your time.')
    await ask({ prompt: ANSWER_LAST_PROMPT, question: 'What did you ship?' })

    expect(useAi.getState().messages[0]?.question).toBe('What did you ship?')
  })

  it('stays on an answer that is continued', async () => {
    const result = await ask({ prompt: ANSWER_LAST_PROMPT, question: 'What did you ship?' })
    const cut = useAi.getState().messages[0]!.id
    act(() => useAi.getState().finishRequest(cut, 'length'))
    hear('b', 'Something said since.')
    await act(() => result.current.run({ prompt: 'continue', continueFrom: cut }))

    expect(useAi.getState().messages).toHaveLength(1)
    expect(useAi.getState().messages[0]?.question).toBe('What did you ship?')
  })
})
