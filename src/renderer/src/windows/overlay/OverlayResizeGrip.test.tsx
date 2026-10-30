// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { MAX_OVERLAY_WIDTH, MIN_OVERLAY_WIDTH } from '@shared/overlayLayout'
import { OverlayResizeGrip } from './OverlayResizeGrip'
import { DEFAULT_ANSWER_MAX_HEIGHT, MIN_ANSWER_MAX_HEIGHT } from './answerPaneResize'

function setWindow(innerWidth: number, availWidth = 1920): void {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true })
  Object.defineProperty(window.screen, 'availWidth', { value: availWidth, configurable: true })
}

function renderGrip(overrides: { answerHeight?: number; hardCap?: number } = {}) {
  const handlers = {
    onWidthChange: vi.fn<(n: number) => void>(),
    onHeightChange: vi.fn<(n: number) => void>(),
    onWidthCommit: vi.fn<(n: number) => void>(),
    onHeightCommit: vi.fn<(n: number) => void>()
  }
  const utils = render(
    <TooltipProvider>
      <OverlayResizeGrip
        answerHeight={overrides.answerHeight ?? DEFAULT_ANSWER_MAX_HEIGHT}
        hardCap={overrides.hardCap ?? 700}
        {...handlers}
      />
    </TooltipProvider>
  )
  const grip = utils.getByTestId('overlay-resize-grip')
  return { ...utils, ...handlers, grip }
}

beforeEach(() => setWindow(720))
afterEach(cleanup)

describe('OverlayResizeGrip', () => {
  it('is a focusable corner handle with a diagonal resize cursor', () => {
    const { grip } = renderGrip()
    expect(grip.style.cursor).toBe('nwse-resize')
    expect(grip.tabIndex).toBe(0)
    expect(grip.getAttribute('role')).toBe('separator')
  })

  describe('dragging', () => {
    it('changes the width live while the left edge stays the anchor, and commits on release', () => {
      const { grip, onWidthChange, onWidthCommit } = renderGrip()
      fireEvent.mouseDown(grip, { clientX: 700, clientY: 500 })
      fireEvent.mouseMove(document, { clientX: 760, clientY: 500 })
      expect(onWidthChange).toHaveBeenLastCalledWith(780)
      expect(onWidthCommit).not.toHaveBeenCalled()
      fireEvent.mouseUp(document)
      expect(onWidthCommit).toHaveBeenCalledWith(780)
    })

    it('changes the answer height from the vertical movement', () => {
      const { grip, onHeightChange, onHeightCommit, onWidthChange, onWidthCommit } = renderGrip({
        answerHeight: 320
      })
      fireEvent.mouseDown(grip, { clientX: 700, clientY: 500 })
      fireEvent.mouseMove(document, { clientX: 700, clientY: 550 })
      expect(onHeightChange).toHaveBeenLastCalledWith(370)
      fireEvent.mouseUp(document)
      expect(onHeightCommit).toHaveBeenCalledWith(370)
      expect(onWidthChange).not.toHaveBeenCalled()
      expect(onWidthCommit).not.toHaveBeenCalled()
    })

    it('changes both at once on a diagonal drag', () => {
      const { grip, onWidthCommit, onHeightCommit } = renderGrip({ answerHeight: 320 })
      fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: -100, clientY: -40 })
      fireEvent.mouseUp(document)
      expect(onWidthCommit).toHaveBeenCalledWith(620)
      expect(onHeightCommit).toHaveBeenCalledWith(280)
    })

    it('stops at the minimum and maximum width', () => {
      const { grip, onWidthChange } = renderGrip()
      fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: -900, clientY: 0 })
      expect(onWidthChange).toHaveBeenLastCalledWith(MIN_OVERLAY_WIDTH)
      fireEvent.mouseMove(document, { clientX: 5000, clientY: 0 })
      expect(onWidthChange).toHaveBeenLastCalledWith(MAX_OVERLAY_WIDTH)
    })

    it('never exceeds the display width', () => {
      setWindow(720, 900)
      const { grip, onWidthChange } = renderGrip()
      fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: 5000, clientY: 0 })
      expect(onWidthChange).toHaveBeenLastCalledWith(900)
    })

    it('keeps the answer height between its minimum and the hard cap', () => {
      const { grip, onHeightChange } = renderGrip({ answerHeight: 320, hardCap: 700 })
      fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: 0, clientY: -900 })
      expect(onHeightChange).toHaveBeenLastCalledWith(MIN_ANSWER_MAX_HEIGHT)
      fireEvent.mouseMove(document, { clientX: 0, clientY: 900 })
      expect(onHeightChange).toHaveBeenLastCalledWith(700)
    })

    it('does not commit a gesture that went nowhere', () => {
      const { grip, onWidthCommit, onHeightCommit } = renderGrip()
      fireEvent.mouseDown(grip, { clientX: 10, clientY: 10 })
      fireEvent.mouseUp(document)
      expect(onWidthCommit).not.toHaveBeenCalled()
      expect(onHeightCommit).not.toHaveBeenCalled()
    })

    it('ignores other mouse buttons and movement after release', () => {
      const { grip, onWidthChange } = renderGrip()
      fireEvent.mouseDown(grip, { button: 2, clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: 50, clientY: 0 })
      expect(onWidthChange).not.toHaveBeenCalled()
      fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 })
      fireEvent.mouseUp(document)
      fireEvent.mouseMove(document, { clientX: 50, clientY: 0 })
      expect(onWidthChange).not.toHaveBeenCalled()
    })
  })

  describe('keyboard', () => {
    it('ArrowRight and ArrowLeft change the width', () => {
      const { grip, onWidthChange, onWidthCommit } = renderGrip()
      fireEvent.keyDown(grip, { key: 'ArrowRight' })
      expect(onWidthChange).toHaveBeenLastCalledWith(740)
      expect(onWidthCommit).toHaveBeenLastCalledWith(740)
      fireEvent.keyDown(grip, { key: 'ArrowLeft', shiftKey: true })
      expect(onWidthChange).toHaveBeenLastCalledWith(640)
    })

    it('does nothing at the width limits', () => {
      setWindow(MIN_OVERLAY_WIDTH)
      const { grip, onWidthChange } = renderGrip()
      fireEvent.keyDown(grip, { key: 'ArrowLeft' })
      expect(onWidthChange).not.toHaveBeenCalled()
    })

    it('ArrowDown and ArrowUp change the answer height, Home and End jump to the extremes', () => {
      const { grip, onHeightChange, onHeightCommit } = renderGrip({ answerHeight: 320 })
      fireEvent.keyDown(grip, { key: 'ArrowDown' })
      expect(onHeightChange).toHaveBeenLastCalledWith(340)
      expect(onHeightCommit).toHaveBeenLastCalledWith(340)
      fireEvent.keyDown(grip, { key: 'ArrowUp', shiftKey: true })
      expect(onHeightChange).toHaveBeenLastCalledWith(240)
      fireEvent.keyDown(grip, { key: 'Home' })
      expect(onHeightChange).toHaveBeenLastCalledWith(MIN_ANSWER_MAX_HEIGHT)
      fireEvent.keyDown(grip, { key: 'End' })
      expect(onHeightChange).toHaveBeenLastCalledWith(700)
    })

    it('ignores other keys', () => {
      const { grip, onWidthChange, onHeightChange } = renderGrip()
      fireEvent.keyDown(grip, { key: 'a' })
      expect(onWidthChange).not.toHaveBeenCalled()
      expect(onHeightChange).not.toHaveBeenCalled()
    })
  })

  describe('double-click', () => {
    it('resets width and height to their defaults', () => {
      setWindow(900)
      const { grip, onWidthChange, onWidthCommit, onHeightChange, onHeightCommit } = renderGrip({
        answerHeight: 500
      })
      fireEvent.doubleClick(grip)
      expect(onWidthChange).toHaveBeenCalledWith(720)
      expect(onWidthCommit).toHaveBeenCalledWith(720)
      expect(onHeightChange).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
      expect(onHeightCommit).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
    })

    it('does nothing when already at the defaults', () => {
      const { grip, onWidthChange, onHeightChange } = renderGrip()
      fireEvent.doubleClick(grip)
      expect(onWidthChange).not.toHaveBeenCalled()
      expect(onHeightChange).not.toHaveBeenCalled()
    })
  })
})
