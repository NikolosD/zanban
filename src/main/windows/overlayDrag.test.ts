import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  cursor: { x: 0, y: 0 },
  workAreas: [{ x: 0, y: 0, width: 1920, height: 1040 }]
}))

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => electron.cursor,
    getAllDisplays: () => electron.workAreas.map((workArea) => ({ workArea })),
    getDisplayMatching: () => ({ workArea: electron.workAreas[0] })
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
  contentHeight = 500
  getBounds = () => ({ x: this.position[0], y: this.position[1], width: 720, height: 500 })
  getContentSize = () => [720, this.contentHeight]
  setContentSize = vi.fn()
  setBounds = vi.fn((b: { x: number; y: number }) => {
    this.position = [b.x, b.y]
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

    expect(win.setBounds).toHaveBeenCalledWith({ x: 700, y: 112, width: 720, height: 500 })
  })

  it('does not touch the window while the cursor stands still', () => {
    const { win } = setup()
    vi.advanceTimersByTime(DRAG_TICK_MS * 5)

    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('keeps the pill on a display', () => {
    const { win } = setup()
    electron.cursor = { x: 9000, y: 30 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    const [bounds] = win.setBounds.mock.calls[0]!
    expect(bounds.x + 360).toBe(1920 - 140)
  })

  it('stops on dragEnd and reports where the window ended up', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    stopOverlayDrag()
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)

    expect(win.setBounds).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledWith({ x: 700, y: 112 })
  })

  it('stops on blur', () => {
    const { win, onStop } = setup()
    win.emit('blur')
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)

    expect(win.setBounds).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('stops on blur and keeps the final spot when the window moved', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    win.emit('blur')

    expect(onStop).toHaveBeenCalledWith({ x: 700, y: 112 })
  })

  it('stops on hide', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    win.emit('hide')

    expect(onStop).toHaveBeenCalledOnce()
    expect(win.listenerCount('hide')).toBe(0)
    expect(win.listenerCount('blur')).toBe(0)
  })

  it('stops quietly when the window is destroyed', () => {
    const { win, onStop } = setup()
    win.destroyed = true
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    expect(win.setBounds).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
    electron.cursor = { x: 1200, y: 500 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)
    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('stops by itself after the safety cap', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_MAX_MS)

    expect(onStop).toHaveBeenCalledOnce()
    const moves = win.setBounds.mock.calls.length
    electron.cursor = { x: 1000, y: 400 }
    vi.advanceTimersByTime(DRAG_TICK_MS * 3)
    expect(win.setBounds).toHaveBeenCalledTimes(moves)
  })

  it('ends a drag in progress when a new one starts', () => {
    const first = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    const second = setup()

    expect(first.onStop).toHaveBeenCalledOnce()
    expect(second.onStop).not.toHaveBeenCalled()
  })

  it('does not report twice when stopped repeatedly', () => {
    const { win, onStop } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    stopOverlayDrag()
    stopOverlayDrag()
    win.emit('blur')

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('does not report or persist a plain click that never moved the window', () => {
    const { win, onStop } = setup()
    stopOverlayDrag()

    expect(onStop).not.toHaveBeenCalled()
    expect(win.setContentSize).not.toHaveBeenCalled()
  })

  it('rounds fractional cursor positions to whole pixels', () => {
    const { win } = setup()
    electron.cursor = { x: 800.6, y: 130.4 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    expect(win.setBounds).toHaveBeenCalledWith({ x: 701, y: 112, width: 720, height: 500 })
  })

  it('re-applies the size captured at the start on every move', () => {
    const { win } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    electron.cursor = { x: 900, y: 140 }
    vi.advanceTimersByTime(DRAG_TICK_MS)

    for (const [bounds] of win.setBounds.mock.calls) {
      expect(bounds).toMatchObject({ width: 720, height: 500 })
    }
  })

  it('pulls a tall window back above the bottom edge once the drag ends', () => {
    const { win } = setup()
    win.contentHeight = 1000
    electron.cursor = { x: 700, y: 530 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    stopOverlayDrag()

    expect(win.setContentSize).toHaveBeenCalledWith(720, 1040 - 512 - 24, false)
  })

  it('leaves a window that already fits alone', () => {
    const { win } = setup()
    electron.cursor = { x: 800, y: 130 }
    vi.advanceTimersByTime(DRAG_TICK_MS)
    stopOverlayDrag()

    expect(win.setContentSize).not.toHaveBeenCalled()
  })
})
