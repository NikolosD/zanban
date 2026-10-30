import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { alternativeAccelerators } from './hotkeyAlternatives'

describe('alternativeAccelerators', () => {
  it('offers a short, ordered, duplicate-free list', () => {
    const list = alternativeAccelerators([])
    expect(list.length).toBeGreaterThan(0)
    expect(list.length).toBeLessThanOrEqual(10)
    expect(new Set(list).size).toBe(list.length)
  })

  it('leaves out accelerators that are already in use, ignoring case', () => {
    const all = alternativeAccelerators([])
    const list = alternativeAccelerators([all[0]!.toUpperCase(), all[1]!.toLowerCase()])
    expect(list).toEqual(all.slice(2))
  })

  it('returns nothing when every candidate is in use', () => {
    expect(alternativeAccelerators(alternativeAccelerators([]))).toEqual([])
  })

  it('does not change the taken list it was given', () => {
    const taken = ['Control+Shift+4']
    alternativeAccelerators(taken)
    expect(taken).toEqual(['Control+Shift+4'])
  })

  it('keeps the same order whatever is taken', () => {
    const all = alternativeAccelerators([])
    const rest = alternativeAccelerators(all.slice(1, 2))
    expect(rest).toEqual([all[0], ...all.slice(2)])
  })

  it('never suggests a default hotkey, so a pick cannot swap two actions', () => {
    const defaults = Object.values(DEFAULT_SETTINGS.hotkeys)
    for (const accelerator of alternativeAccelerators([])) {
      expect(defaults).not.toContain(accelerator)
    }
  })

  it('leaves alone the shortcuts other apps rely on during a call', () => {
    const list = alternativeAccelerators([])
    for (const taken of [
      'Control+Shift+S',
      'Control+Shift+A',
      'Control+Shift+D',
      'Control+Shift+G',
      'Control+Shift+H'
    ]) {
      expect(list).not.toContain(taken)
    }
  })

  it('pairs Ctrl+Alt only with keys that AltGr layouts do not type with', () => {
    for (const accelerator of alternativeAccelerators([])) {
      if (accelerator.startsWith('Control+Alt+')) {
        expect(['R', 'H', 'J']).toContain(accelerator.split('+').at(-1))
      }
    }
  })

  it('only suggests chords with a modifier', () => {
    for (const accelerator of alternativeAccelerators([])) {
      expect(accelerator.split('+').length).toBeGreaterThan(1)
    }
  })
})
