import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps a theme font size next to a text color', () => {
    expect(cn('text-meta', 'text-success')).toBe('text-meta text-success')
  })

  it('still lets a later font size win', () => {
    expect(cn('text-meta text-foreground', 'text-small')).toBe('text-foreground text-small')
  })
})
