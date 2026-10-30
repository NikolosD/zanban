// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@shared/locales/en.json'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useAi } from '@renderer/features/ai/store'
import { useSettingsStore } from '@renderer/features/settings/store'
import { useTranscript } from '@renderer/features/transcript/store'
import { OverlayApp } from './OverlayApp'

vi.mock('@renderer/audio/captureController', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/audio/captureController')>()),
  wireCaptureAutostop: () => () => {}
}))

const CODE = 'const a = 1\n\nconst longLine = "x".repeat(400)\n'

interface Bridge {
  setExpanded: ReturnType<typeof vi.fn>
  scrollAnswer(direction: 'up' | 'down'): void
  toggleExpandCode(): void
  visibilityChanged(visible: boolean): void
}

function stubBridge(): Bridge {
  let scrollListener: (direction: 'up' | 'down') => void = () => {}
  let toggleListener: () => void = () => {}
  let visibilityListener: (visible: boolean) => void = () => {}
  const setExpanded = vi.fn(async () => {})
  const overrides: Record<string, unknown> = {
    'settings.get': async () => DEFAULT_SETTINGS,
    'overlay.getStealth': async () => true,
    'overlay.setExpanded': setExpanded,
    'overlay.onScrollAnswer': (cb: typeof scrollListener) => {
      scrollListener = cb
      return () => {}
    },
    'overlay.onToggleExpandCode': (cb: typeof toggleListener) => {
      toggleListener = cb
      return () => {}
    },
    'overlay.onVisibilityChanged': (cb: typeof visibilityListener) => {
      visibilityListener = cb
      return () => {}
    }
  }
  const namespace = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_target, method: string) =>
        overrides[`${name}.${method}`] ??
        (/^on[A-Z]/.test(method) ? () => () => {} : async () => undefined)
    })
  vi.stubGlobal(
    'zanban',
    new Proxy({} as Record<string, unknown>, { get: (_target, name: string) => namespace(name) })
  )
  return {
    setExpanded,
    scrollAnswer: (direction) => act(() => scrollListener(direction)),
    toggleExpandCode: () => act(() => toggleListener()),
    visibilityChanged: (visible) => act(() => visibilityListener(visible))
  }
}

async function mountWithCode(): Promise<void> {
  act(() => {
    useAi.getState().newRequest('q', 'r1')
    useAi.getState().appendChunk('r1', '```js\n' + CODE + '```')
    useAi.getState().finishRequest('r1')
  })
  render(<OverlayApp />)
  await screen.findByText('expand')
}

function answerScroller(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-more-below]')!
}

function expandedScroller(): HTMLElement | null {
  return document.querySelector('.zb-codeblock[data-large="true"]')?.parentElement ?? null
}

function overflow(el: HTMLElement, m: { scrollHeight: number; clientHeight: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: m.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: m.clientHeight })
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false }
  })
})

beforeEach(() => {
  useAi.getState().reset()
  useTranscript.getState().reset()
  useSettingsStore.setState({ settings: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('overlay code blocks', () => {
  it('numbers the real lines and keeps the code text exactly as written', async () => {
    stubBridge()
    await mountWithCode()

    const block = document.querySelector('.zb-codeblock')!
    const lines = block.querySelectorAll('.zb-line')
    expect(block.getAttribute('data-numbered')).toBe('true')
    expect(block.getAttribute('data-wrap')).toBe('true')
    expect(lines).toHaveLength(3)
    expect(block.querySelector('code')!.textContent).toBe(CODE)
    expect(block.querySelector('pre')!.textContent).toBe(CODE)
  })

  it('switches a block between wrapping and one scrolling line per source line', async () => {
    stubBridge()
    await mountWithCode()
    const block = document.querySelector('.zb-codeblock')!

    fireEvent.click(screen.getByText('no wrap'))
    expect(block.getAttribute('data-wrap')).toBe('false')
    expect(block.querySelector('code')!.textContent).toBe(CODE)

    fireEvent.click(screen.getByText('wrap'))
    expect(block.getAttribute('data-wrap')).toBe('true')
  })

  it('scrolls the answer a page at a time from the hotkeys', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    const scroller = answerScroller()
    overflow(scroller, { scrollHeight: 900, clientHeight: 300 })
    scroller.scrollBy = vi.fn()

    bridge.scrollAnswer('down')
    bridge.scrollAnswer('up')

    expect(scroller.scrollBy).toHaveBeenNthCalledWith(1, expect.objectContaining({ top: 240 }))
    expect(scroller.scrollBy).toHaveBeenNthCalledWith(2, expect.objectContaining({ top: -240 }))
  })

  it('does nothing on a scroll hotkey when the answer fits', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    const scroller = answerScroller()
    overflow(scroller, { scrollHeight: 300, clientHeight: 300 })
    scroller.scrollBy = vi.fn()

    bridge.scrollAnswer('down')

    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })
})

describe('expanded code', () => {
  it('grows the window and shows only that block, larger and numbered', async () => {
    const bridge = stubBridge()
    await mountWithCode()

    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')

    expect(bridge.setExpanded).toHaveBeenCalledWith(true)
    const big = document.querySelector('.zb-codeblock[data-large="true"]')!
    expect(big.querySelectorAll('.zb-line')).toHaveLength(3)
    expect(big.querySelector('code')!.textContent).toBe(CODE)
    expect(big.querySelector('[data-code-expand]')).toBeNull()
  })

  it('keeps the expanded text out of window drags', async () => {
    stubBridge()
    await mountWithCode()
    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')

    expect(expandedScroller()!.hasAttribute('data-no-drag')).toBe(true)
  })

  it('returns to the previous size and scroll position on the button', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    answerScroller().scrollTop = 120

    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')
    answerScroller().scrollTop = 0
    fireEvent.click(screen.getByText('collapse'))
    await screen.findByText('expand')

    expect(bridge.setExpanded).toHaveBeenLastCalledWith(false)
    expect(expandedScroller()).toBeNull()
    expect(answerScroller().scrollTop).toBe(120)
  })

  it('closes on Esc', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')

    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByText('expand')

    expect(bridge.setExpanded).toHaveBeenLastCalledWith(false)
    expect(expandedScroller()).toBeNull()
  })

  it('toggles from the hotkey', async () => {
    const bridge = stubBridge()
    await mountWithCode()

    bridge.toggleExpandCode()
    await screen.findByText('collapse')
    expect(bridge.setExpanded).toHaveBeenLastCalledWith(true)

    bridge.toggleExpandCode()
    await screen.findByText('expand')
    expect(bridge.setExpanded).toHaveBeenLastCalledWith(false)
  })

  it('scrolls the expanded block, not the hidden answer, from the scroll hotkeys', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    const hidden = answerScroller()
    hidden.scrollBy = vi.fn()
    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')
    const big = expandedScroller()!
    overflow(big, { scrollHeight: 2000, clientHeight: 500 })
    big.scrollBy = vi.fn()

    bridge.scrollAnswer('down')

    expect(big.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 400 }))
    expect(hidden.scrollBy).not.toHaveBeenCalled()
  })

  it('collapses when the overlay is hidden', async () => {
    const bridge = stubBridge()
    await mountWithCode()
    fireEvent.click(screen.getByText('expand'))
    await screen.findByText('collapse')

    bridge.visibilityChanged(false)
    await screen.findByText('expand')

    expect(bridge.setExpanded).toHaveBeenLastCalledWith(false)
  })
})
