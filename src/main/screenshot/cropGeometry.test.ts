import { describe, it, expect } from 'vitest'
import { cssRectToCroppedPx } from './cropGeometry'

describe('cssRectToCroppedPx', () => {
  it('scales a CSS-px selection up to source device px at 1.0 scaleFactor', () => {
    const out = cssRectToCroppedPx({ x: 100, y: 50, w: 200, h: 120, dpr: 1 }, 1, 1920, 1080)
    expect(out).toEqual({ x: 100, y: 50, width: 200, height: 120 })
  })

  it('applies the display scaleFactor (Windows 150% scaling)', () => {
    // User drags a 200x100 CSS-px box; the source was rastered at 1.5x.
    const out = cssRectToCroppedPx(
      { x: 80, y: 40, w: 200, h: 100, dpr: 1.5 },
      1.5,
      2880, // 1920 * 1.5
      1620 // 1080 * 1.5
    )
    expect(out).toEqual({ x: 120, y: 60, width: 300, height: 150 })
  })

  it('ignores renderer dpr in favor of the source scaleFactor', () => {
    // dpr disagrees with scaleFactor (the bug F3 fixes) — scaleFactor wins.
    const out = cssRectToCroppedPx({ x: 100, y: 100, w: 100, h: 100, dpr: 1 }, 2, 4000, 4000)
    expect(out).toEqual({ x: 200, y: 200, width: 200, height: 200 })
  })

  it('clamps the extent so the crop never runs past the source edge', () => {
    // Selection runs to/over the right + bottom edge.
    const out = cssRectToCroppedPx({ x: 1800, y: 1000, w: 400, h: 400, dpr: 1 }, 1, 1920, 1080)
    expect(out).toEqual({ x: 1800, y: 1000, width: 120, height: 80 })
  })

  it('pulls a negative origin to 0 and shortens the extent', () => {
    const out = cssRectToCroppedPx({ x: -20, y: -10, w: 100, h: 100, dpr: 1 }, 1, 1920, 1080)
    expect(out).toEqual({ x: 0, y: 0, width: 80, height: 90 })
  })

  it('returns null when the clamped selection has zero area', () => {
    // Origin sits exactly on the right edge — nothing left to crop.
    expect(cssRectToCroppedPx({ x: 1920, y: 0, w: 100, h: 100, dpr: 1 }, 1, 1920, 1080)).toBeNull()
  })

  it('returns null for a fully off-screen (negative) selection', () => {
    expect(
      cssRectToCroppedPx({ x: -200, y: -200, w: 100, h: 100, dpr: 1 }, 1, 1920, 1080)
    ).toBeNull()
  })

  it('falls back to scale 1 for a non-positive scaleFactor', () => {
    const out = cssRectToCroppedPx({ x: 10, y: 10, w: 50, h: 50, dpr: 1 }, 0, 1920, 1080)
    expect(out).toEqual({ x: 10, y: 10, width: 50, height: 50 })
  })
})
