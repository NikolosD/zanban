import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  getDisplayMatching: vi.fn(),
  startOverlayDrag: vi.fn(),
  stopOverlayDrag: vi.fn(),
  updateOverlayDragHeight: vi.fn()
}))

vi.mock('electron', () => ({ screen: { getDisplayMatching: mocks.getDisplayMatching } }))
vi.mock('../ipc/guard.js', () => ({
  handleIpc: (channel: string, fn: (...args: never[]) => unknown) => mocks.handlers.set(channel, fn)
}))
vi.mock('./overlayDrag.js', () => ({
  startOverlayDrag: mocks.startOverlayDrag,
  stopOverlayDrag: mocks.stopOverlayDrag,
  updateOverlayDragHeight: mocks.updateOverlayDragHeight
}))

import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { registerOverlayWindowIpc } from './overlayIpc'

function fakeWindow() {
  const listeners = new Map<string, () => void>()
  const state = { x: 300, y: 200, width: 640, height: 380 }
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ ...state }),
    setBounds: vi.fn((next: typeof state) => Object.assign(state, next)),
    getContentSize: () => [state.width, state.height],
    setContentSize: vi.fn(),
    on: (event: string, fn: () => void) => listeners.set(event, fn)
  }
  return { win: win as unknown as BrowserWindow, raw: win, state, listeners }
}

const call = (channel: string, ...args: unknown[]): unknown =>
  (mocks.handlers.get(channel) as (...a: unknown[]) => unknown)({}, ...args)

describe('overlay window IPC', () => {
  let onDragStop: Mock<(position: { x: number; y: number }) => void>

  beforeEach(() => {
    mocks.handlers.clear()
    mocks.getDisplayMatching.mockReset()
    mocks.getDisplayMatching.mockReturnValue({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 }
    })
    mocks.startOverlayDrag.mockReset()
    mocks.stopOverlayDrag.mockReset()
    mocks.updateOverlayDragHeight.mockReset()
    onDragStop = vi.fn<(position: { x: number; y: number }) => void>()
  })

  function setup() {
    const w = fakeWindow()
    const ipc = registerOverlayWindowIpc(() => w.win, onDragStop)
    ipc.watch(w.win)
    return w
  }

  it('sizes the window to the measured content and starts drags when not expanded', () => {
    const { raw } = setup()

    call(IPC.overlay.setContentHeight, 500)
    call(IPC.overlay.dragStart)

    expect(raw.setContentSize).toHaveBeenCalledWith(640, 500, false)
    expect(mocks.updateOverlayDragHeight).toHaveBeenCalledWith(500)
    expect(mocks.startOverlayDrag).toHaveBeenCalledWith(raw, onDragStop)
  })

  it('ignores content-height requests while expanded and honours them after', () => {
    const { raw } = setup()
    call(IPC.overlay.setExpanded, true)

    call(IPC.overlay.setContentHeight, 500)
    expect(raw.setContentSize).not.toHaveBeenCalled()

    call(IPC.overlay.setExpanded, false)
    call(IPC.overlay.setContentHeight, 500)
    expect(raw.setContentSize).toHaveBeenCalledTimes(1)
  })

  it('ignores drag starts while expanded and honours them after', () => {
    setup()
    call(IPC.overlay.setExpanded, true)

    call(IPC.overlay.dragStart)
    expect(mocks.startOverlayDrag).not.toHaveBeenCalled()

    call(IPC.overlay.setExpanded, false)
    call(IPC.overlay.dragStart)
    expect(mocks.startOverlayDrag).toHaveBeenCalledTimes(1)
  })

  it('stops a drag in progress when expanding, so no tick shrinks the window back', () => {
    setup()

    call(IPC.overlay.setExpanded, true)
    expect(mocks.stopOverlayDrag).toHaveBeenCalledTimes(1)

    call(IPC.overlay.setExpanded, false)
    expect(mocks.stopOverlayDrag).toHaveBeenCalledTimes(1)
  })

  it('restores the window when the overlay is hidden while expanded', () => {
    const { state, listeners } = setup()
    call(IPC.overlay.setExpanded, true)
    expect(state.height).toBe(1004)

    listeners.get('hide')!()

    expect(state).toEqual({ x: 300, y: 200, width: 640, height: 380 })
  })

  it('does nothing on hide when not expanded', () => {
    const { raw, listeners } = setup()

    listeners.get('hide')!()

    expect(raw.setBounds).not.toHaveBeenCalled()
  })
})
