// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KeyRecorder } from './KeyRecorder'

function renderRecorder(overrides: { value?: string; defaultValue?: string } = {}) {
  const onChange = vi.fn()
  const utils = render(
    <KeyRecorder
      value={overrides.value ?? ''}
      defaultValue={overrides.defaultValue ?? 'Control+Shift+H'}
      onChange={onChange}
    />
  )
  // The recorder always renders the trigger as the first <button> in the
  // tree; reset / clear buttons (if any) come after it.
  const recordButton = () => utils.container.querySelector('button')!
  return { ...utils, onChange, recordButton }
}

function pressKey(init: KeyboardEventInit) {
  // KeyRecorder listens on `window` with capture=true, so we must dispatch
  // on the document and let the capture phase pick it up.
  fireEvent.keyDown(document, init)
}

describe('KeyRecorder (DOM)', () => {
  it('shows the placeholder when no binding is set', () => {
    renderRecorder()
    expect(screen.getByText('click to record…')).toBeTruthy()
  })

  it('renders the current binding as Kbd chips, no recording state', () => {
    renderRecorder({ value: 'Control+Shift+H' })
    // Three chips → three <kbd> elements.
    expect(document.querySelectorAll('kbd').length).toBe(3)
  })

  it('captures a valid combo, calls onChange with the canonical accelerator string, exits recording', () => {
    const { onChange, recordButton } = renderRecorder()
    fireEvent.click(recordButton())
    expect(screen.getByText(/press keys…/)).toBeTruthy()

    pressKey({ code: 'KeyH', key: 'h', ctrlKey: true, shiftKey: true })

    expect(onChange).toHaveBeenCalledWith('Control+Shift+H')
    // Recording mode exits after a successful capture.
    expect(screen.queryByText(/press keys…/)).toBeNull()
  })

  it('Escape cancels recording without firing onChange', () => {
    const { onChange, recordButton } = renderRecorder()
    fireEvent.click(recordButton())
    pressKey({ code: 'Escape', key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/press keys…/)).toBeNull()
  })

  it('plain Backspace clears the binding', () => {
    const { onChange, recordButton } = renderRecorder({ value: 'Control+Shift+H' })
    fireEvent.click(recordButton())
    pressKey({ code: 'Backspace', key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('rejects bare letter keys without a modifier', () => {
    const { onChange, recordButton } = renderRecorder()
    fireEvent.click(recordButton())
    pressKey({ code: 'KeyA', key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
    // Still in recording mode — waiting for a modifier.
    expect(screen.getByText(/press keys…/)).toBeTruthy()
  })
})
