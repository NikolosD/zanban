import { describe, it, expect } from 'vitest'
import { prettyAccelerator } from './KeyRecorder'

// Detect platform path the file sees — IS_MAC inside KeyRecorder is captured
// at module load. node test environment has no `navigator.platform`, so the
// file's IS_MAC ends up false. These expectations match the non-mac branch.

describe('prettyAccelerator', () => {
  it('joins parts with spaced plus sign', () => {
    expect(prettyAccelerator('Control+Shift+Space')).toBe('Ctrl + Shift + Space')
  })

  it('translates known modifier and named keys', () => {
    expect(prettyAccelerator('Control+Return')).toBe('Ctrl + ↵')
    expect(prettyAccelerator('Alt+Backspace')).toBe('Alt + ⌫')
    expect(prettyAccelerator('Control+Shift+H')).toBe('Ctrl + Shift + H')
  })

  it('handles arrow keys', () => {
    expect(prettyAccelerator('Control+Up')).toBe('Ctrl + ↑')
    expect(prettyAccelerator('Control+Left')).toBe('Ctrl + ←')
  })

  it('passes unknown tokens through unchanged', () => {
    expect(prettyAccelerator('Control+F11')).toBe('Ctrl + F11')
    expect(prettyAccelerator('Control+\\')).toBe('Ctrl + \\')
  })

  it('returns empty string for empty input', () => {
    expect(prettyAccelerator('')).toBe('')
  })
})
