// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@shared/locales/en.json'
import { AnswerScroller } from './AnswerScroller'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function metrics(el: HTMLElement, m: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: m.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: m.clientHeight })
}

async function mount(m: { scrollHeight: number; clientHeight: number }) {
  vi.useFakeTimers()
  const ref = { current: null as HTMLDivElement | null }
  const view = render(
    <AnswerScroller ref={ref} maxHeight={200} contentKey="a">
      <p>answer</p>
    </AnswerScroller>
  )
  metrics(ref.current!, m)
  view.rerender(
    <AnswerScroller ref={ref} maxHeight={200} contentKey="b">
      <p>answer</p>
    </AnswerScroller>
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  return ref
}

describe('AnswerScroller', () => {
  it('shows no hint and no fade when the answer fits', async () => {
    const ref = await mount({ scrollHeight: 150, clientHeight: 200 })

    expect(screen.queryByText('↓ more')).toBeNull()
    expect(ref.current!.className).not.toContain('mask-image')
  })

  it('offers the hint and fades the bottom edge when more waits below', async () => {
    const ref = await mount({ scrollHeight: 600, clientHeight: 200 })

    expect(screen.getByText('↓ more')).toBeTruthy()
    expect(ref.current!.className).toContain('mask-image')
    expect(ref.current!.className).toContain('24px')
  })

  it('drops the hint once scrolled to the end', async () => {
    const ref = await mount({ scrollHeight: 600, clientHeight: 200 })

    ref.current!.scrollTop = 400
    fireEvent.scroll(ref.current!)

    expect(screen.queryByText('↓ more')).toBeNull()
  })

  it('scrolls on when the hint is clicked', async () => {
    const ref = await mount({ scrollHeight: 600, clientHeight: 200 })
    const scrollBy = vi.fn()
    ref.current!.scrollBy = scrollBy

    fireEvent.click(screen.getByText('↓ more'))

    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: 'smooth' })
  })

  it('jumps instead of gliding when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const ref = await mount({ scrollHeight: 600, clientHeight: 200 })
    const scrollBy = vi.fn()
    ref.current!.scrollBy = scrollBy

    fireEvent.click(screen.getByText('↓ more'))

    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: 'auto' })
  })
})
