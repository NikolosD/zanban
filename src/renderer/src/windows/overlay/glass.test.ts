import { describe, it, expect } from 'vitest'
import { overlayGlassAlpha } from './glass'

describe('overlayGlassAlpha', () => {
  it('maps the opacity range onto the glass alpha range', () => {
    expect(overlayGlassAlpha(0.4)).toBe(0.6)
    expect(overlayGlassAlpha(0.7)).toBe(0.775)
    expect(overlayGlassAlpha(1)).toBe(0.95)
  })

  it('clamps out-of-range settings', () => {
    expect(overlayGlassAlpha(0)).toBe(0.6)
    expect(overlayGlassAlpha(2)).toBe(0.95)
  })
})
