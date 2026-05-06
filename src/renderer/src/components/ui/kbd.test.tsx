// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Kbd } from './kbd'

describe('Kbd', () => {
  it('renders a semantic <kbd> element with the given content', () => {
    const { container } = render(<Kbd>X</Kbd>)
    const kbd = container.querySelector('kbd')
    expect(kbd).not.toBeNull()
    expect(kbd?.textContent).toBe('X')
  })

  it('uses the small size by default', () => {
    const { container } = render(<Kbd>A</Kbd>)
    const kbd = container.querySelector('kbd')!
    // The "sm" branch keeps a one-line height; the "md" branch doesn't.
    expect(kbd.className).toContain('h-3.5')
    expect(kbd.className).not.toContain('h-5')
  })

  it('switches to the medium variant on size="md"', () => {
    const { container } = render(<Kbd size="md">A</Kbd>)
    const kbd = container.querySelector('kbd')!
    expect(kbd.className).toContain('h-5')
    expect(kbd.className).toContain('border')
  })

  it('forwards extra classes via className', () => {
    const { container } = render(<Kbd className="text-red-500">A</Kbd>)
    expect(container.querySelector('kbd')?.className).toContain('text-red-500')
  })
})
