import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDisplayMatching = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ screen: { getDisplayMatching } }))

import type { BrowserWindow } from 'electron'
import { createOverlayExpansion } from './overlayExpand'

function fakeWindow(bounds: { x: number; y: number; width: number; height: number }) {
  const state = { ...bounds }
  const win = {
    isDestroyed: () => false,
    getBounds: () => ({ ...state }),
    setBounds: vi.fn((next: typeof state) => Object.assign(state, next))
  }
  return { win: win as unknown as BrowserWindow, raw: win, state }
}

describe('createOverlayExpansion', () => {
  beforeEach(() => {
    getDisplayMatching.mockReset()
    getDisplayMatching.mockReturnValue({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  })

  it('grows to the work-area height and restores the previous top and height', () => {
    const { win, state } = fakeWindow({ x: 300, y: 200, width: 640, height: 380 })
    const expansion = createOverlayExpansion()

    expansion.set(win, true)
    expect(expansion.isExpanded()).toBe(true)
    expect(state).toEqual({ x: 300, y: 12, width: 640, height: 1004 })

    expansion.set(win, false)
    expect(expansion.isExpanded()).toBe(false)
    expect(state).toEqual({ x: 300, y: 200, width: 640, height: 380 })
  })

  it('uses the display the window is on', () => {
    getDisplayMatching.mockReturnValue({
      workArea: { x: 1920, y: 1080, width: 1920, height: 1040 }
    })
    const { win, state } = fakeWindow({ x: 2000, y: 1200, width: 640, height: 380 })

    createOverlayExpansion().set(win, true)

    expect(state).toMatchObject({ y: 1092, height: 1004 })
  })

  it('keeps a width changed while expanded', () => {
    const { win, state } = fakeWindow({ x: 300, y: 200, width: 640, height: 380 })
    const expansion = createOverlayExpansion()
    expansion.set(win, true)
    state.width = 800

    expansion.set(win, false)

    expect(state).toEqual({ x: 300, y: 200, width: 800, height: 380 })
  })

  it('does not remember an intermediate size when expanded twice', () => {
    const { win, state } = fakeWindow({ x: 0, y: 200, width: 640, height: 380 })
    const expansion = createOverlayExpansion()
    expansion.set(win, true)
    expansion.set(win, true)
    expansion.set(win, false)

    expect(state).toMatchObject({ y: 200, height: 380 })
  })

  it('ignores a collapse when nothing is expanded', () => {
    const { win, raw } = fakeWindow({ x: 0, y: 200, width: 640, height: 380 })
    createOverlayExpansion().set(win, false)

    expect(raw.setBounds).not.toHaveBeenCalled()
  })

  it('asks for the display the window is on, using the window bounds', () => {
    const { win } = fakeWindow({ x: 300, y: 200, width: 640, height: 380 })
    const expansion = createOverlayExpansion()

    expansion.set(win, true)
    expect(getDisplayMatching).toHaveBeenLastCalledWith({ x: 300, y: 200, width: 640, height: 380 })
    expansion.set(win, false)
    expect(getDisplayMatching).toHaveBeenLastCalledWith({ x: 300, y: 12, width: 640, height: 1004 })
  })

  it('re-fits the saved size to a smaller display on restore', () => {
    const { win, state } = fakeWindow({ x: 300, y: 900, width: 640, height: 600 })
    const expansion = createOverlayExpansion()
    expansion.set(win, true)
    getDisplayMatching.mockReturnValue({ workArea: { x: 0, y: 0, width: 1280, height: 720 } })

    expansion.set(win, false)

    expect(state.y).toBe(720 - 120 - 24)
    expect(state.y + state.height).toBeLessThanOrEqual(720)
    expect(state.height).toBe(120)
  })

  it('puts the saved top back inside a display that sits lower than before', () => {
    const { win, state } = fakeWindow({ x: 300, y: 50, width: 640, height: 380 })
    const expansion = createOverlayExpansion()
    expansion.set(win, true)
    getDisplayMatching.mockReturnValue({ workArea: { x: 0, y: 1080, width: 1920, height: 1040 } })

    expansion.set(win, false)

    expect(state.y).toBe(1080)
    expect(state.height).toBe(380)
  })
})
