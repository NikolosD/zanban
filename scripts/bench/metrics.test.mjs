import { describe, expect, it } from 'vitest'
import {
  classifyRect,
  contrastRatio,
  declaredContrast,
  edgeEnergy,
  luminance,
  percentile,
  rectContrast
} from './metrics.mjs'

function bitmap(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const inBox = (x, y) => x >= 10 && x < 20 && y >= 10 && y < 20

describe('luminance and contrast', () => {
  it('maps black and white to the WCAG extremes', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 5)
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5)
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 5)
  })

  it('gives 1 for equal colors', () => {
    expect(contrastRatio(luminance(120, 30, 30), luminance(120, 30, 30))).toBe(1)
  })
})

describe('percentile', () => {
  it('interpolates and handles empty input', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([5], 0.1)).toBe(5)
    expect(percentile([10, 0], 0)).toBe(0)
  })
})

describe('rectContrast', () => {
  const rect = { x: 10, y: 10, w: 10, h: 10 }

  it('scores white text on black as 21', () => {
    const bmp = bitmap(30, 30, (x, y) => (inBox(x, y) ? [255, 255, 255] : [0, 0, 0]))
    expect(rectContrast(bmp, rect)).toBeCloseTo(21, 3)
  })

  it('scores flat areas as 1', () => {
    const bmp = bitmap(30, 30, () => [90, 90, 90])
    expect(rectContrast(bmp, rect)).toBeCloseTo(1, 5)
  })

  it('drops when the surround is closer in tone to the text', () => {
    const dark = bitmap(30, 30, (x, y) => (inBox(x, y) ? [255, 255, 255] : [20, 20, 20]))
    const mid = bitmap(30, 30, (x, y) => (inBox(x, y) ? [255, 255, 255] : [160, 160, 160]))
    expect(rectContrast(mid, rect)).toBeLessThan(rectContrast(dark, rect))
  })

  it('returns null for rects outside the bitmap', () => {
    const bmp = bitmap(5, 5, () => [0, 0, 0])
    expect(rectContrast(bmp, { x: 50, y: 50, w: 4, h: 4 })).toBeNull()
  })
})

describe('edgeEnergy', () => {
  const flat = bitmap(20, 20, () => [128, 128, 128])
  const stripes = bitmap(20, 20, (x) => (x % 2 === 0 ? [0, 0, 0] : [255, 255, 255]))
  const region = { x: 0, y: 0, w: 20, h: 20 }

  it('is zero on a flat bitmap and positive on stripes', () => {
    expect(edgeEnergy(flat, region)).toBe(0)
    expect(edgeEnergy(stripes, region)).toBeGreaterThan(100)
  })

  it('ignores masked pixels', () => {
    expect(edgeEnergy(stripes, region, [region])).toBe(0)
    const half = edgeEnergy(stripes, region, [{ x: 0, y: 0, w: 10, h: 20 }])
    expect(half).toBeCloseTo(edgeEnergy(stripes, region), 0)
  })
})

describe('classifyRect', () => {
  const clip = [0, 0, 100, 100]

  it('detects fully visible rects', () => {
    expect(classifyRect({ x: 10, y: 10, w: 20, h: 12 }, clip)).toBe('visible')
  })

  it('detects a line cut at the bottom edge', () => {
    expect(classifyRect({ x: 10, y: 92, w: 20, h: 12 }, clip)).toBe('cutV')
  })

  it('detects horizontal clipping', () => {
    expect(classifyRect({ x: 90, y: 10, w: 30, h: 12 }, clip)).toBe('cutH')
  })

  it('treats rects past the edge as hidden', () => {
    expect(classifyRect({ x: 10, y: 120, w: 20, h: 12 }, clip)).toBe('hidden')
  })

  it('tolerates sub-pixel overshoot', () => {
    expect(classifyRect({ x: 10, y: 88.4, w: 20, h: 12 }, clip)).toBe('visible')
  })
})

describe('declaredContrast', () => {
  it('composites the text alpha over the surround', () => {
    expect(declaredContrast([255, 255, 255, 1], [0, 0, 0])).toBeCloseTo(21, 3)
    expect(declaredContrast([255, 255, 255, 0], [0, 0, 0])).toBe(1)
    expect(declaredContrast([255, 255, 255, 0.5], [0, 0, 0])).toBeLessThan(21)
  })
})
