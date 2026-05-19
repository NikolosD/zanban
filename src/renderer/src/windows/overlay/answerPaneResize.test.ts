import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ANSWER_MAX_HEIGHT,
  MIN_ANSWER_MAX_HEIGHT,
  ABSOLUTE_MAX_ANSWER_HEIGHT,
  computeHardCap,
  clampAnswerHeight
} from './answerPaneResize'

describe('answerPaneResize', () => {
  it('exposes the constants the UI relies on', () => {
    expect(DEFAULT_ANSWER_MAX_HEIGHT).toBe(320)
    expect(MIN_ANSWER_MAX_HEIGHT).toBe(200)
    expect(ABSOLUTE_MAX_ANSWER_HEIGHT).toBe(720)
  })

  it('computeHardCap subtracts 200 from availHeight and caps at 720', () => {
    expect(computeHardCap(1080)).toBe(720) // 1080-200=880 → capped to 720
    expect(computeHardCap(900)).toBe(700) // 900-200=700, under cap
    expect(computeHardCap(500)).toBe(300) // small monitor
  })

  it('computeHardCap never drops below MIN', () => {
    // Very small reported availHeight (degenerate / mocked screen)
    expect(computeHardCap(100)).toBe(MIN_ANSWER_MAX_HEIGHT)
  })

  it('clampAnswerHeight respects MIN and the runtime cap', () => {
    expect(clampAnswerHeight(50, 700)).toBe(MIN_ANSWER_MAX_HEIGHT)
    expect(clampAnswerHeight(400, 700)).toBe(400)
    expect(clampAnswerHeight(900, 700)).toBe(700)
  })
})
