// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ZanbanMark, type ZanbanMarkVariant } from './ZanbanMark'

const VARIANTS: ZanbanMarkVariant[] = ['phase-dot', 'half-disk', 'arc', 'wedge', 'sonar', 'split']

describe('ZanbanMark', () => {
  it.each(VARIANTS)('renders an svg of the requested size for variant %s', (variant) => {
    const { container } = render(<ZanbanMark variant={variant} size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('height')).toBe('32')
  })

  it('defaults to phase-dot when no variant is given', () => {
    const ref = render(<ZanbanMark variant="phase-dot" size={20} />)
    const def = render(<ZanbanMark size={20} />)
    // Same SVG output — easiest sanity check that the default branch matches.
    expect(def.container.innerHTML).toBe(ref.container.innerHTML)
  })

  it('marks itself aria-hidden when no aria-label is provided', () => {
    const { container } = render(<ZanbanMark size={16} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
  })

  it('exposes role=img with the given aria-label', () => {
    const { container } = render(<ZanbanMark size={16} aria-label="Zanban logo" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Zanban logo')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })
})
