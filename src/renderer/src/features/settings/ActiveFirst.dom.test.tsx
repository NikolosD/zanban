// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ActiveFirst } from './ActiveFirst'

const items = [{ value: 'a' }, { value: 'b' }, { value: 'c' }]

afterEach(() => {
  cleanup()
})

describe('ActiveFirst', () => {
  it('shows the active item and folds the others behind one button', () => {
    const { queryByText, getByRole } = render(
      <ActiveFirst items={items} active="b" render={(p) => <div key={p.value}>{p.value}</div>} />
    )
    expect(queryByText('b')).not.toBeNull()
    expect(queryByText('a')).toBeNull()

    fireEvent.click(getByRole('button'))
    expect(queryByText('a')).not.toBeNull()
    expect(queryByText('c')).not.toBeNull()
    expect(getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })
})
