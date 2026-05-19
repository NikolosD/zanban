/**
 * Pure helpers for the answer-pane resize handle. Kept DOM-free so the math
 * is trivially unit-testable.
 */

export const DEFAULT_ANSWER_MAX_HEIGHT = 320
export const MIN_ANSWER_MAX_HEIGHT = 200
export const ABSOLUTE_MAX_ANSWER_HEIGHT = 720

/**
 * Largest height the answer pane is allowed to take on the current display.
 * Reserves ~200px for status bar, chips row, and input pill, then caps at
 * 720px so the overlay never dominates the screen even on tall monitors.
 *
 * If the computed cap would fall below MIN (degenerate monitors / mocked
 * screen in tests) we clamp up to MIN so the UI is still usable.
 */
export function computeHardCap(availHeight: number): number {
  const headroom = availHeight - 200
  const capped = Math.min(headroom, ABSOLUTE_MAX_ANSWER_HEIGHT)
  return Math.max(MIN_ANSWER_MAX_HEIGHT, capped)
}

/**
 * Apply both the floor (MIN) and the runtime ceiling (hardCap).
 */
export function clampAnswerHeight(requested: number, hardCap: number): number {
  if (requested < MIN_ANSWER_MAX_HEIGHT) return MIN_ANSWER_MAX_HEIGHT
  if (requested > hardCap) return hardCap
  return requested
}
