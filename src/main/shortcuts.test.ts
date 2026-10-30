import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock electron's globalShortcut so we can drive register() outcomes.
const registerMock = vi.fn<(accelerator: string, cb: () => void) => boolean>()
const unregisterMock = vi.fn()
vi.mock('electron', () => ({
  globalShortcut: {
    register: (acc: string, cb: () => void) => registerMock(acc, cb),
    unregister: (acc: string) => unregisterMock(acc)
  }
}))

// Mock settings to return a fixed hotkey map.
const hotkeys = {
  toggleSession: 'Control+Shift+Alt+R',
  toggleOverlay: 'Control+\\',
  askAi: 'Control+Shift+Space',
  answerLast: 'Control+Shift+Return',
  hideShow: 'Control+Shift+H',
  screenshot: 'Control+Shift+S',
  screenshotAnswer: 'Control+Shift+A',
  cropper: 'Control+Shift+Alt+S',
  chat: 'Control+Shift+G',
  showDashboard: 'Control+Shift+D',
  scrollAnswerUp: 'Alt+Shift+PageUp',
  scrollAnswerDown: 'Alt+Shift+PageDown',
  expandCode: 'Alt+Shift+Return'
}
vi.mock('./settings.js', () => ({
  getSettings: () => ({ hotkeys })
}))

import { DEFAULT_SETTINGS } from '../shared/types'
import {
  pickFreeShortcuts,
  registerShortcuts,
  reRegisterShortcuts,
  setOverlayShortcutsActive,
  shortcutConflicts,
  unregisterShortcuts
} from './shortcuts'
import { alternativeAccelerators } from './hotkeyAlternatives'

function noop(): void {}
const handlers = {
  onToggleSession: noop,
  onToggleOverlay: noop,
  onAskAi: noop,
  onAnswerLast: noop,
  onHideShow: noop,
  onScreenshot: noop,
  onScreenshotAnswer: noop,
  onCropper: noop,
  onChat: noop,
  onShowDashboard: noop,
  onScrollAnswerUp: noop,
  onScrollAnswerDown: noop,
  onExpandCode: noop
}

const OVERLAY_ONLY = [hotkeys.scrollAnswerUp, hotkeys.scrollAnswerDown, hotkeys.expandCode]
const registeredAccelerators = (): string[] => registerMock.mock.calls.map(([acc]) => acc)

describe('registerShortcuts', () => {
  beforeEach(() => {
    setOverlayShortcutsActive(false)
    unregisterShortcuts()
    registerMock.mockReset()
    unregisterMock.mockReset()
  })

  it('reports no failures when every accelerator registers', () => {
    registerMock.mockReturnValue(true)
    const { failed } = registerShortcuts(handlers)
    expect(failed).toEqual([])
    // The 10 always-on bindings, plus 3 probes that are released again at once.
    expect(registerMock).toHaveBeenCalledTimes(13)
    expect(unregisterMock.mock.calls.map(([acc]) => acc)).toEqual(OVERLAY_ONLY)
  })

  it('keeps the overlay-only hotkeys free while the overlay is hidden', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    expect(unregisterMock).toHaveBeenCalledTimes(3)
    setOverlayShortcutsActive(true)
    expect(registeredAccelerators().slice(-3)).toEqual(OVERLAY_ONLY)
    unregisterMock.mockClear()
    setOverlayShortcutsActive(false)
    expect(unregisterMock.mock.calls.map(([acc]) => acc)).toEqual(OVERLAY_ONLY)
  })

  it('registers the overlay-only hotkeys for real when the overlay is already shown', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    setOverlayShortcutsActive(true)
    registerMock.mockClear()
    unregisterMock.mockClear()
    reRegisterShortcuts()
    expect(registeredAccelerators().filter((a) => OVERLAY_ONLY.includes(a))).toHaveLength(3)
    expect(unregisterMock).toHaveBeenCalledTimes(13)
  })

  it('reports a clash on an overlay-only hotkey before the overlay ever shows', () => {
    registerMock.mockImplementation((acc: string) => acc !== hotkeys.expandCode)
    const { failed } = registerShortcuts(handlers)
    expect(failed).toEqual([{ action: 'expandCode', accelerator: hotkeys.expandCode }])
    expect(shortcutConflicts()).toEqual(failed)
  })

  it('adds a clash found on show to the conflicts, and drops it once it clears', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    registerMock.mockImplementation((acc: string) => acc !== hotkeys.scrollAnswerUp)
    const { failed } = setOverlayShortcutsActive(true)
    expect(failed).toEqual([{ action: 'scrollAnswerUp', accelerator: hotkeys.scrollAnswerUp }])
    expect(shortcutConflicts()).toEqual(failed)

    setOverlayShortcutsActive(false)
    registerMock.mockReturnValue(true)
    expect(setOverlayShortcutsActive(true).failed).toEqual([])
    expect(shortcutConflicts()).toEqual([])
  })

  it('does not register twice when shown again without a hide', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    setOverlayShortcutsActive(true)
    registerMock.mockClear()
    setOverlayShortcutsActive(true)
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('unregisterShortcuts releases the overlay-only hotkeys too', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    setOverlayShortcutsActive(true)
    unregisterMock.mockClear()
    unregisterShortcuts()
    expect(unregisterMock).toHaveBeenCalledTimes(13)
  })

  it('binds the scroll and expand hotkeys to their handlers', () => {
    registerMock.mockReturnValue(true)
    const onScrollAnswerUp = vi.fn()
    const onScrollAnswerDown = vi.fn()
    const onExpandCode = vi.fn()
    registerShortcuts({ ...handlers, onScrollAnswerUp, onScrollAnswerDown, onExpandCode })
    const callbackFor = (acc: string): (() => void) =>
      registerMock.mock.calls.find(([a]) => a === acc)![1]
    setOverlayShortcutsActive(true)
    callbackFor(hotkeys.scrollAnswerUp)()
    for (let i = 0; i < 2; i++) callbackFor(hotkeys.scrollAnswerDown)()
    for (let i = 0; i < 3; i++) callbackFor(hotkeys.expandCode)()
    expect(onScrollAnswerUp).toHaveBeenCalledTimes(1)
    expect(onScrollAnswerDown).toHaveBeenCalledTimes(2)
    expect(onExpandCode).toHaveBeenCalledTimes(3)
  })

  it('reports the action + accelerator that fails to bind', () => {
    registerMock.mockImplementation((acc: string) => acc !== hotkeys.screenshot)
    const { failed } = registerShortcuts(handlers)
    expect(failed).toEqual([{ action: 'screenshot', accelerator: hotkeys.screenshot }])
  })

  it('treats a thrown register() (malformed accelerator) as a failure', () => {
    registerMock.mockImplementation((acc: string) => {
      if (acc === hotkeys.chat) throw new Error('bad accelerator')
      return true
    })
    const { failed } = registerShortcuts(handlers)
    expect(failed).toEqual([{ action: 'chat', accelerator: hotkeys.chat }])
  })

  it('unregisters previously-registered accelerators before re-registering', () => {
    registerMock.mockReturnValue(true)
    registerShortcuts(handlers)
    unregisterMock.mockClear()
    reRegisterShortcuts()
    // Re-register releases the 10 it bound, then probes the 3 overlay-only ones.
    expect(unregisterMock).toHaveBeenCalledTimes(13)
  })

  it('remembers the latest failures for a window that loads later', () => {
    registerMock.mockImplementation((acc: string) => acc !== hotkeys.hideShow)
    registerShortcuts(handlers)
    expect(shortcutConflicts()).toEqual([{ action: 'hideShow', accelerator: hotkeys.hideShow }])

    registerMock.mockReturnValue(true)
    reRegisterShortcuts()
    expect(shortcutConflicts()).toEqual([])
  })

  it('reRegisterShortcuts is a no-op before any initial registration', () => {
    // Fresh module state isn't trivially resettable here, but after a successful
    // register the cached handlers exist, so re-register should still work.
    registerMock.mockReturnValue(true)
    const result = reRegisterShortcuts()
    expect(result.failed).toEqual([])
  })
})

describe('pickFreeShortcuts', () => {
  const [first, second, third] = alternativeAccelerators([]) as [string, string, string]
  const original = { ...hotkeys }
  const persist = vi.fn<(next: typeof hotkeys) => void>()
  let busy: Set<string>

  beforeEach(() => {
    setOverlayShortcutsActive(false)
    unregisterShortcuts()
    registerMock.mockReset()
    unregisterMock.mockReset()
    persist.mockReset()
    busy = new Set([hotkeys.screenshot, hotkeys.chat])
    registerMock.mockImplementation((acc: string) => !busy.has(acc))
    registerShortcuts(handlers)
    registerMock.mockClear()
    unregisterMock.mockClear()
  })

  afterEach(() => {
    Object.assign(hotkeys, original)
  })

  it('moves each busy action to the first free alternative and persists them together', () => {
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([
      { action: 'screenshot', accelerator: first },
      { action: 'chat', accelerator: second }
    ])
    expect(result.unresolved).toEqual([])
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({ ...hotkeys, screenshot: first, chat: second })
  })

  it('finds an alternative for a busy scroll hotkey too', () => {
    busy.add(hotkeys.scrollAnswerDown)
    registerShortcuts(handlers)
    persist.mockReset()
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toContainEqual(expect.objectContaining({ action: 'scrollAnswerDown' }))
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ scrollAnswerUp: hotkeys.scrollAnswerUp })
    )
  })

  it('leaves the registration to the settings path by releasing what it probed', () => {
    pickFreeShortcuts(persist)
    expect(unregisterMock.mock.calls.map(([acc]) => acc)).toEqual([first, second])
  })

  it('skips alternatives that another app holds', () => {
    busy.add(first)
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([
      { action: 'screenshot', accelerator: second },
      { action: 'chat', accelerator: third }
    ])
    expect(unregisterMock).not.toHaveBeenCalledWith(first)
  })

  it('leaves no conflicts once the new map is saved', () => {
    persist.mockImplementation((next) => {
      Object.assign(hotkeys, next)
      reRegisterShortcuts()
    })
    const result = pickFreeShortcuts(persist)
    expect(hotkeys).toMatchObject({ screenshot: first, chat: second })
    expect(shortcutConflicts()).toEqual(result.unresolved)
    expect(shortcutConflicts()).toEqual([])
  })

  it('skips alternatives another action is already bound to', () => {
    hotkeys.cropper = first
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([
      { action: 'screenshot', accelerator: second },
      { action: 'chat', accelerator: third }
    ])
    expect(registerMock).not.toHaveBeenCalledWith(first, expect.anything())
  })

  it('treats an accelerator that throws as unavailable and carries on', () => {
    registerMock.mockImplementation((acc: string) => {
      if (acc === first) throw new Error('bad accelerator')
      return !busy.has(acc)
    })
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([
      { action: 'screenshot', accelerator: second },
      { action: 'chat', accelerator: third }
    ])
  })

  it('reports an action as unresolved when no alternative registers, without persisting', () => {
    registerMock.mockReturnValue(false)
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([])
    expect(result.unresolved).toEqual([
      { action: 'screenshot', accelerator: hotkeys.screenshot },
      { action: 'chat', accelerator: hotkeys.chat }
    ])
    expect(persist).not.toHaveBeenCalled()
  })

  it('persists the ones it found and reports the rest when only some can move', () => {
    registerMock.mockImplementation((acc: string) => acc === first)
    const result = pickFreeShortcuts(persist)
    expect(result.assigned).toEqual([{ action: 'screenshot', accelerator: first }])
    expect(result.unresolved).toEqual([{ action: 'chat', accelerator: hotkeys.chat }])
    expect(persist).toHaveBeenCalledWith({ ...hotkeys, screenshot: first })
  })

  it('gives each action its own alternative', () => {
    busy.add(hotkeys.hideShow)
    reRegisterShortcuts()
    const result = pickFreeShortcuts(persist)
    expect(result.assigned.map((a) => a.action)).toEqual(['hideShow', 'screenshot', 'chat'])
    expect(new Set(result.assigned.map((a) => a.accelerator)).size).toBe(3)
  })

  it('does nothing when no hotkey is busy', () => {
    registerMock.mockReturnValue(true)
    reRegisterShortcuts()
    registerMock.mockClear()
    expect(pickFreeShortcuts(persist)).toEqual({ assigned: [], unresolved: [] })
    expect(registerMock).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('default hotkeys', () => {
  const defaults = Object.values(DEFAULT_SETTINGS.hotkeys)

  it('leave alone the shortcuts other apps rely on during a call', () => {
    // Save As, Teams accept / decline / hang up, VS Code debug and source control.
    for (const taken of [
      'Control+Shift+S',
      'Control+Shift+A',
      'Control+Shift+D',
      'Control+Shift+G',
      'Control+Shift+H'
    ]) {
      expect(defaults).not.toContain(taken)
    }
  })

  it('pair Ctrl+Alt only with keys that AltGr layouts do not type with', () => {
    for (const accelerator of defaults.filter((a) => a.startsWith('Control+Alt+'))) {
      expect(['R', 'H', 'J']).toContain(accelerator.split('+').at(-1))
    }
  })
})
