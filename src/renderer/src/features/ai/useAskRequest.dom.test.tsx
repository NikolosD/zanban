// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  vi.unstubAllGlobals()
  useAi.getState().reset()
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
