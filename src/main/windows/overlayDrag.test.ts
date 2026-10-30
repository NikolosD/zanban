import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  cursor: { x: 0, y: 0 },
  workAreas: [{ x: 0, y: 0, width: 1920, height: 1040 }]
}))

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => electron.cursor,
    getAllDisplays: () => electron.workAreas.map((workArea) => ({ workArea }))
  }
}))

const { DRAG_MAX_MS, DRAG_TICK_MS, startOverlayDrag, stopOverlayDrag } =
  await import('./overlayDrag')
const { EventEmitter } = await import('node:events')

class FakeWindow extends EventEmitter {
  destroyed = false
  position = [600, 12]
  isDestroyed = () => this.destroyed
  getPosition = () => this.position
  getSize = () => [720, 500]
  setPosition = vi.fn((x: number, y: number) => {
    this.position = [x, y]
  })
}

function setup() {
  const win = new FakeWindow()
  const onStop = vi.fn()
  electron.cursor = { x: 700, y: 30 }
  startOverlayDrag(win as never, onStop)
  return { win, onStop }
}

beforeEach(() => {
  vi.useFakeTimers()
  electron.workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }]
})

afterEach(() => {
  stopOverlayDrag()
  vi.useRealTimers()
})

describe('overlay drag loop', () => {
  it('moves the window with the cursor, keeping the grab offset', () => {
    const { win } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    expect(win.setPosition).toHaveBeenCalledWith(700, 112)
  })

  it('does not touch the window while the cursor stands still', () => {
    const { win } = setup()
    vi.advanceTimersByTime(DRAG_TICK_MS * 5)

    expect(win.setPosition).not.toHaveBeenCalled()
  })

  it('keeps the pill on a display', () => {
    const { win } = setup()
    electron.cursor = { x: 9000, y: 30 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    const [x] = win.setPosition.mock.calls[0]!
    expect(x + 360).toBe(1920 - 140)
  })

  it('stops on dragEnd and reports where the window ended up', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    stopOverlayDrag()
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)

    expect(win.setPosition).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledWith({ x: 700, y: 112 })
  })

  it('stops on blur', () => {
    const { win, onStop } = setup()
    win.emit('blur')
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)

    expect(win.setPosition).not.toHaveBeenCalled()
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('stops on hide', () => {
    const { win, onStop } = setup()
    win.emit('hide')

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('stops quietly when the window is destroyed', () => {
    const { win, onStop } = setup()
    win.destroyed = true
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    expect(win.setPosition).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
    electron.cursor = { x: 1200, y: 500 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)
    expect(win.setPosition).not.toHaveBeenCalled()
  })

  it('stops by itself after the safety cap', () => {
    const { win, onStop } = setup()
    vi.advanceTimersByTime(DRAG_MAX_MS)

    expect(onStop).toHaveBeenCalledOnce()
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)
    expect(win.setPosition).not.toHaveBeenCalled()
  })

  it('ends a drag in progress when a new one starts', () => {
    const first = setup()
    const second = setup()

    expect(first.onStop).toHaveBeenCalledOnce()
    expect(second.onStop).not.toHaveBeenCalled()
  })

  it('does not report twice when stopped repeatedly', () => {
    const { win, onStop } = setup()
    stopOverlayDrag()
    stopOverlayDrag()
    win.emit('blur')

    expect(onStop).toHaveBeenCalledOnce()
  })
})
