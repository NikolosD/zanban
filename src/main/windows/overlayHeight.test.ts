import { describe, expect, it } from 'vitest'
import { clampOverlayTop, expandedOverlayBounds, fitOverlayHeight } from './overlayHeight.js'

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

describe('expandedOverlayBounds', () => {
  it('spans the work area from just below its top, leaving the bottom margin', () => {
    expect(expandedOverlayBounds({ y: 0, height: 1040 })).toEqual({ y: 12, height: 1004 })
  })

  it('follows a monitor below or above the primary one', () => {
    expect(expandedOverlayBounds({ y: 1080, height: 1040 })).toEqual({ y: 1092, height: 1004 })
    expect(expandedOverlayBounds({ y: -1080, height: 1040 })).toEqual({ y: -1068, height: 1004 })
  })

  it('keeps the minimum height on a tiny work area', () => {
    expect(expandedOverlayBounds({ y: 0, height: 100 }).height).toBe(120)
  })
})

describe('clampOverlayTop', () => {
  const area = { y: 100, height: 1000 }

  it('leaves a top inside the work area alone', () => {
    expect(clampOverlayTop(300, area)).toBe(300)
  })

  it('lifts a top above the work area to its edge', () => {
    expect(clampOverlayTop(-50, area)).toBe(100)
  })

  it('keeps room for the minimum height below the top', () => {
    expect(clampOverlayTop(5000, area)).toBe(100 + 1000 - 120 - 24)
  })
})
