// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  actionItemStorageKey,
  hashText,
  isActionItemChecked,
  setActionItemChecked,
  subscribeActionItemState
} from './actionItemState'

afterEach(() => {
  localStorage.clear()
})

describe('hashText', () => {
  it('is stable for the same text and ignores surrounding whitespace', () => {
    expect(hashText('Do the thing')).toBe(hashText('  Do the thing  '))
  })

  it('differs for different text', () => {
    expect(hashText('Do the thing')).not.toBe(hashText('Do another thing'))
  })

  it('produces a positive base36 string', () => {
    expect(hashText('anything')).toMatch(/^[0-9a-z]+$/)
  })
})

describe('actionItemStorageKey', () => {
  it('is keyed by session id and text hash, not array index', () => {
    const key = actionItemStorageKey('sess1', { text: 'Ship it' })
    expect(key).toBe(`recap-checked-v2-sess1-${hashText('Ship it')}`)
  })
})

describe('checked-state round trip', () => {
  it('persists and reads back a checked item by stable text identity', () => {
    const item = { text: 'Send the recap' }
    expect(isActionItemChecked('s1', item)).toBe(false)
    setActionItemChecked('s1', item, true)
    expect(isActionItemChecked('s1', item)).toBe(true)
    setActionItemChecked('s1', item, false)
    expect(isActionItemChecked('s1', item)).toBe(false)
  })

  it('does not desync when sibling items are reordered or inserted', () => {
    // Check item B, then simulate a regenerate that reorders/inserts items.
    setActionItemChecked('s1', { text: 'Item B' }, true)
    // The checkbox follows the *text*, regardless of new index position.
    expect(isActionItemChecked('s1', { text: 'Item B' })).toBe(true)
    expect(isActionItemChecked('s1', { text: 'Item A (newly inserted first)' })).toBe(false)
  })

  it('isolates state per session', () => {
    setActionItemChecked('sessA', { text: 'shared text' }, true)
    expect(isActionItemChecked('sessB', { text: 'shared text' })).toBe(false)
  })
})

describe('subscribeActionItemState', () => {
  it('notifies every time an item is checked or unchecked', () => {
    const listener = vi.fn()
    const off = subscribeActionItemState(listener)

    setActionItemChecked('s1', { text: 'Send the recap' }, true)
    setActionItemChecked('s1', { text: 'Send the recap' }, false)

    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })

  it('stops notifying once unsubscribed', () => {
    const listener = vi.fn()
    subscribeActionItemState(listener)()

    setActionItemChecked('s1', { text: 'Send the recap' }, true)

    expect(listener).not.toHaveBeenCalled()
  })
})
