// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AnswerPaneResizer } from './AnswerPaneResizer'
import { DEFAULT_ANSWER_MAX_HEIGHT, MIN_ANSWER_MAX_HEIGHT } from './answerPaneResize'

function renderResizer(overrides: { value?: number; hardCap?: number } = {}) {
  const onChange = vi.fn<(n: number) => void>()
  const onCommit = vi.fn<(n: number) => void>()
  const utils = render(
    <AnswerPaneResizer
      value={overrides.value ?? DEFAULT_ANSWER_MAX_HEIGHT}
      hardCap={overrides.hardCap ?? 700}
      onChange={onChange}
      onCommit={onCommit}
    />
  )
  const handle = utils.container.querySelector('[data-testid="answer-pane-resizer"]') as HTMLElement
  return { ...utils, onChange, onCommit, handle }
}

describe('AnswerPaneResizer', () => {
  it('renders a draggable handle with ns-resize cursor', () => {
    const { handle } = renderResizer()
    expect(handle).toBeTruthy()
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('drag down increases the value and calls onChange live', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 320 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 150 }) // +50px
    expect(onChange).toHaveBeenLastCalledWith(370)
    expect(onCommit).not.toHaveBeenCalled() // not yet
    fireEvent.mouseUp(document)
    expect(onCommit).toHaveBeenCalledWith(370)
  })

  it('drag up decreases value but never below MIN', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 220 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 50 }) // -50 → would be 170
    expect(onChange).toHaveBeenLastCalledWith(MIN_ANSWER_MAX_HEIGHT)
    fireEvent.mouseUp(document)
    expect(onCommit).toHaveBeenCalledWith(MIN_ANSWER_MAX_HEIGHT)
  })

  it('drag respects hardCap', () => {
    const { handle, onChange } = renderResizer({ value: 600, hardCap: 700 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 300 }) // +200 → would be 800
    expect(onChange).toHaveBeenLastCalledWith(700)
  })

  it('does not call onCommit if the value did not actually change', () => {
    const { handle, onCommit } = renderResizer({ value: 320 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseUp(document) // no move
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('double-click resets to default and commits', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 500 })
    fireEvent.doubleClick(handle)
    expect(onChange).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
    expect(onCommit).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
  })

  it('cleans up document listeners after mouseup so further moves do not fire', () => {
    const { handle, onChange } = renderResizer()
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseUp(document)
    onChange.mockClear()
    fireEvent.mouseMove(document, { clientY: 500 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
