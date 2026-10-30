import { describe, expect, it } from 'vitest'
import { MAX_OVERLAY_WIDTH, MIN_OVERLAY_WIDTH, clampOverlayWidth } from './overlayLayout'

describe('clampOverlayWidth', () => {
  it('keeps an in-range width, rounded to whole pixels', () => {
    expect(clampOverlayWidth(720, 1920)).toBe(720)
    expect(clampOverlayWidth(720.6, 1920)).toBe(721)
  })

  it('never goes below the minimum', () => {
    expect(clampOverlayWidth(100, 1920)).toBe(MIN_OVERLAY_WIDTH)
    expect(clampOverlayWidth(-5, 1920)).toBe(MIN_OVERLAY_WIDTH)
  })

  it('never goes above the maximum on a wide display', () => {
    expect(clampOverlayWidth(5000, 3840)).toBe(MAX_OVERLAY_WIDTH)
  })

  it('never goes wider than a narrow display', () => {
    expect(clampOverlayWidth(1000, 800)).toBe(800)
  })

  it('keeps the minimum even when the display is narrower than it', () => {
    expect(clampOverlayWidth(700, 300)).toBe(MIN_OVERLAY_WIDTH)
  })
})
