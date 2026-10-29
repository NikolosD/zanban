import { describe, expect, it } from 'vitest'
import { fitOverlayHeight } from './overlayHeight.js'

describe('fitOverlayHeight', () => {
  it('fits the content on the primary display', () => {
    expect(fitOverlayHeight(400.2, 12, { y: 0, height: 1040 })).toBe(401)
    expect(fitOverlayHeight(5000, 12, { y: 0, height: 1040 })).toBe(1004)
  })

  it('uses the whole height of a monitor below the primary one', () => {
    expect(fitOverlayHeight(600, 1092, { y: 1080, height: 1040 })).toBe(600)
    expect(fitOverlayHeight(5000, 1092, { y: 1080, height: 1040 })).toBe(1004)
  })

  it('stops at the bottom of a monitor above the primary one', () => {
    expect(fitOverlayHeight(5000, -1068, { y: -1080, height: 1040 })).toBe(1004)
  })

  it('never goes below the minimum', () => {
    expect(fitOverlayHeight(40, 12, { y: 0, height: 1040 })).toBe(120)
  })
})
