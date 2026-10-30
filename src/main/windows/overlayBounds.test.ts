import { describe, expect, it } from 'vitest'
import { clampOverlayPosition, resolveOverlayBounds, topCenterPosition } from './overlayBounds'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const left = { x: -1280, y: 0, width: 1280, height: 984 }
const above = { x: 0, y: -1080, width: 1920, height: 1040 }

describe('topCenterPosition', () => {
  it('centres horizontally with a top margin, offset by the work area origin', () => {
    expect(topCenterPosition(720, primary)).toEqual({ x: 600, y: 12 })
    expect(topCenterPosition(720, { ...primary, x: 100, y: 40 })).toEqual({ x: 700, y: 52 })
  })

  it('sticks to the left edge when the window is wider than the display', () => {
    expect(topCenterPosition(2000, primary).x).toBe(0)
  })
})

describe('clampOverlayPosition', () => {
  it('leaves a position alone while the pill is on a display', () => {
    const position = { x: 600, y: 12 }
    expect(clampOverlayPosition(position, 720, [primary])).toBe(position)
  })

  it('leaves a window straddling two displays alone', () => {
    const position = { x: -500, y: 12 }
    expect(clampOverlayPosition(position, 720, [left, primary])).toBe(position)
  })

  it('allows a monitor to the left with negative x', () => {
    const position = { x: -1000, y: 50 }
    expect(clampOverlayPosition(position, 720, [left, primary])).toBe(position)
  })

  it('allows a monitor above with negative y', () => {
    const position = { x: 600, y: -900 }
    expect(clampOverlayPosition(position, 720, [primary, above])).toBe(position)
  })

  it('pulls a window dragged off the right edge back so the whole pill shows', () => {
    const next = clampOverlayPosition({ x: 5000, y: 12 }, 720, [primary])
    expect(next.x + 360).toBe(1920 - 140)
    expect(next.y).toBe(12)
  })

  it('pulls a window dragged above the top of the only display back down', () => {
    const next = clampOverlayPosition({ x: 600, y: -400 }, 720, [primary])
    expect(next).toEqual({ x: 600, y: -12 })
  })

  it('pulls a window dragged below the work area back up', () => {
    const next = clampOverlayPosition({ x: 600, y: 4000 }, 720, [primary])
    expect(next).toEqual({ x: 600, y: 1040 - 18 - 30 })
  })

  it('clamps into the nearest display when it falls in a gap, negative coordinates included', () => {
    const next = clampOverlayPosition({ x: -3000, y: 100 }, 720, [left, primary])
    expect(next.x + 360).toBe(-1280 + 140)
  })

  it('does nothing when there are no displays to clamp to', () => {
    const position = { x: 9999, y: 9999 }
    expect(clampOverlayPosition(position, 720, [])).toBe(position)
  })
})

describe('resolveOverlayBounds', () => {
  it('goes top-centre of the primary display with no saved position', () => {
    expect(resolveOverlayBounds({ position: null, width: 720 }, [primary], primary)).toEqual({
      x: 600,
      y: 12,
      width: 720
    })
  })

  it('restores a saved position that is still on a display', () => {
    const next = resolveOverlayBounds(
      { position: { x: -900, y: 40 }, width: 720 },
      [left, primary],
      primary
    )
    expect(next).toEqual({ x: -900, y: 40, width: 720 })
  })

  it('falls back to top-centre when the monitor it was on is gone', () => {
    const next = resolveOverlayBounds(
      { position: { x: -900, y: 40 }, width: 720 },
      [primary],
      primary
    )
    expect(next).toEqual({ x: 600, y: 12, width: 720 })
  })

  it('narrows a saved width that no longer fits the display', () => {
    const small = { x: 0, y: 0, width: 800, height: 600 }
    const next = resolveOverlayBounds({ position: null, width: 1100 }, [small], small)
    expect(next.width).toBe(800)
    expect(next.x).toBe(0)
  })
})
