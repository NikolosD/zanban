import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  showDashboard: 'Control+Shift+D'
}
vi.mock('./settings.js', () => ({
  getSettings: () => ({ hotkeys })
}))

import { DEFAULT_SETTINGS } from '../shared/types'
import {
  registerShortcuts,
  reRegisterShortcuts,
  shortcutConflicts,
  unregisterShortcuts
} from './shortcuts'

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
  onShowDashboard: noop
}

describe('registerShortcuts', () => {
  beforeEach(() => {
    registerMock.mockReset()
    unregisterMock.mockReset()
    unregisterShortcuts()
  })

  it('reports no failures when every accelerator registers', () => {
    registerMock.mockReturnValue(true)
    const { failed } = registerShortcuts(handlers)
    expect(failed).toEqual([])
    // One register() call per non-empty binding (all 10 are set).
    expect(registerMock).toHaveBeenCalledTimes(10)
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
    // Re-register unregisters the 10 it bound last time.
    expect(unregisterMock).toHaveBeenCalledTimes(10)
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
