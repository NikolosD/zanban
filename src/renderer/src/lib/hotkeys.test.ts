import { describe, it, expect } from 'vitest'
import { hotkeyHint, hotkeyLabel } from './hotkeys'

describe('hotkeyLabel', () => {
  it('returns a friendly label for every known hotkey id', () => {
    // These mirror AppSettings['hotkeys'] keys — if a new one is added the
    // table-based lookup must grow with it. Test enforces "no raw key shown
    // in UI" — the bug that surfaced when showDashboard was missing from the
    // old switch.
    const ids = [
      'toggleOverlay',
      'askAi',
      'answerLast',
      'hideShow',
      'screenshot',
      'cropper',
      'chat',
      'showDashboard'
    ] as const
    for (const id of ids) {
      const label = hotkeyLabel(id)
      expect(label).not.toBe(id)
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the raw key for unknown ids', () => {
    expect(hotkeyLabel('unknown-id')).toBe('unknown-id')
  })
})

describe('hotkeyHint', () => {
  it('returns a non-empty hint for every known hotkey id', () => {
    const ids = [
      'toggleOverlay',
      'askAi',
      'answerLast',
      'hideShow',
      'screenshot',
      'cropper',
      'chat',
      'showDashboard'
    ] as const
    for (const id of ids) {
      expect(hotkeyHint(id).length).toBeGreaterThan(0)
    }
  })

  it('returns empty string for unknown ids', () => {
    expect(hotkeyHint('mystery')).toBe('')
  })
})
