import { describe, it, expect } from 'vitest'
import { ANSWER_SURFACE, overlayGlassAlpha } from './glass'

describe('overlayGlassAlpha', () => {
  it('maps the opacity range onto the glass alpha range', () => {
    expect(overlayGlassAlpha(0.4)).toBe(0.85)
    expect(overlayGlassAlpha(0.7)).toBe(0.9)
    expect(overlayGlassAlpha(1)).toBe(0.95)
  })

  it('clamps out-of-range settings', () => {
    expect(overlayGlassAlpha(0)).toBe(0.85)
    expect(overlayGlassAlpha(2)).toBe(0.95)
  })
})

describe('ANSWER_SURFACE', () => {
  it('is near-solid, so page text behind the window cannot show through the answer', () => {
    expect(ANSWER_SURFACE).toContain('/0.97')
  })
})
