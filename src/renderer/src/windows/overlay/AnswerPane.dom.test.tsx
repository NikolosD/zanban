// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'
import { useAi } from '@renderer/features/ai/store'
import { useAskRequest } from '@renderer/features/ai/useAskRequest'
import { useTranscript } from '@renderer/features/transcript/store'
import { AnswerPane } from './OverlayApp'

const QUESTION = 'How do you handle reconciliation when streams disagree?'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru } },
    interpolation: { escapeValue: false }
  })
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  useAi.getState().reset()
  useTranscript.getState().reset()
  await act(() => i18n.changeLanguage('en'))
})

function card(question?: string) {
  return {
    id: 'r1',
    prompt: 'Answer last question',
    answer: '',
    status: 'done' as const,
    question
  }
}

describe('AnswerPane', () => {
  it('shows the question the answer is for, muted, above it', () => {
    render(<AnswerPane message={card(QUESTION)} onContinue={() => {}} />)

    const line = screen.getByText(`Q: ${QUESTION}`)
    expect(line.className).toContain('text-muted-foreground')
    expect(line.getAttribute('title')).toBe(QUESTION)
    expect(screen.queryByText('Answer last question')).toBeNull()
  })

  it('shows it in the interface language', async () => {
    await act(() => i18n.changeLanguage('ru'))
    render(<AnswerPane message={card(QUESTION)} onContinue={() => {}} />)

    expect(screen.getByText(`Вопрос: ${QUESTION}`)).toBeTruthy()
  })

  it('shows what was asked when there is no question to show', () => {
    render(<AnswerPane message={card()} onContinue={() => {}} />)

    expect(screen.getByText('Answer last question')).toBeTruthy()
    expect(screen.queryByText(/^Q:/)).toBeNull()
  })

  it('keeps the question it was asked with after the call moves on', async () => {
    vi.stubGlobal('zanban', {
      ai: {
        ask: vi.fn(async ({ requestId }: { requestId: string }) => ({ requestId })),
        stop: vi.fn(async () => {})
      }
    })
    useTranscript.getState().pushSegment({
      id: 'a',
      channel: 'system',
      speaker: 0,
      startMs: 0,
      endMs: 0,
      text: QUESTION,
      isFinal: true,
      createdAt: 0
    })
    const { result } = renderHook(() => useAskRequest())
    await act(() => result.current.run({ prompt: ANSWER_LAST_PROMPT }))
    const message = useAi.getState().messages[0]!
    const view = render(<AnswerPane message={message} onContinue={() => {}} />)
    expect(screen.getByText(`Q: ${QUESTION}`)).toBeTruthy()

    act(() =>
      useTranscript.getState().pushSegment({
        id: 'b',
        channel: 'system',
        speaker: 0,
        startMs: 0,
        endMs: 0,
        text: 'Anyway, moving on to the next topic.',
        isFinal: true,
        createdAt: 0
      })
    )
    view.rerender(<AnswerPane message={useAi.getState().messages[0]!} onContinue={() => {}} />)

    expect(screen.getByText(`Q: ${QUESTION}`)).toBeTruthy()
  })
})
