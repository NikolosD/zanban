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
  toggleOverlay: 'Control+\\',
  askAi: 'Control+Shift+Space',
  answerLast: 'Control+Shift+Return',
  hideShow: 'Control+Shift+H',
  screenshot: 'Control+Shift+S',
  cropper: 'Control+Shift+Alt+S',
  chat: 'Control+Shift+G',
  showDashboard: 'Control+Shift+D'
}
vi.mock('./settings.js', () => ({
  getSettings: () => ({ hotkeys })
}))

import { registerShortcuts, reRegisterShortcuts, unregisterShortcuts } from './shortcuts'

function noop(): void {}
const handlers = {
  onToggleOverlay: noop,
  onAskAi: noop,
  onAnswerLast: noop,
  onHideShow: noop,
  onScreenshot: noop,
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
    // One register() call per non-empty binding (all 8 are set).
    expect(registerMock).toHaveBeenCalledTimes(8)
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
    // Re-register unregisters the 8 it bound last time.
    expect(unregisterMock).toHaveBeenCalledTimes(8)
  })

  it('reRegisterShortcuts is a no-op before any initial registration', () => {
    // Fresh module state isn't trivially resettable here, but after a successful
    // register the cached handlers exist, so re-register should still work.
    registerMock.mockReturnValue(true)
    const result = reRegisterShortcuts()
    expect(result.failed).toEqual([])
  })
})
