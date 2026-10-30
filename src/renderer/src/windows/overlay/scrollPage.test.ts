// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollPage } from './scrollPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function scroller(m: { scrollHeight: number; clientHeight: number }): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: m.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { value: m.clientHeight })
  el.scrollBy = vi.fn()
  return el
}

describe('scrollPage', () => {
  it('scrolls down by 80% of the visible height, smoothly', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 200 })

    scrollPage(el, 'down')

    expect(el.scrollBy).toHaveBeenCalledWith({ top: 160, behavior: 'smooth' })
  })

  it('scrolls up by the same amount', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400 })

    scrollPage(el, 'up')

    expect(el.scrollBy).toHaveBeenCalledWith({ top: -320, behavior: 'smooth' })
  })

  it('jumps instead of animating under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const el = scroller({ scrollHeight: 1000, clientHeight: 200 })

    scrollPage(el, 'down')

    expect(el.scrollBy).toHaveBeenCalledWith({ top: 160, behavior: 'auto' })
  })

  it('does nothing when the content fits', () => {
    const el = scroller({ scrollHeight: 200, clientHeight: 200 })

    scrollPage(el, 'down')

    expect(el.scrollBy).not.toHaveBeenCalled()
  })

  it('does nothing without a scroller', () => {
    expect(() => scrollPage(null, 'down')).not.toThrow()
  })
})
