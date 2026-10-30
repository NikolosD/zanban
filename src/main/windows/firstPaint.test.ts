import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAfterFirstPaint } from './firstPaint.js'

describe('runAfterFirstPaint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the task a moment after the first paint, not before', () => {
    const win = new EventEmitter()
    const task = vi.fn()
    runAfterFirstPaint(win, task)

    vi.advanceTimersByTime(1000)
    expect(task).not.toHaveBeenCalled()

    win.emit('ready-to-show')
    vi.advanceTimersByTime(100)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('still runs the task when the window never paints', () => {
    const task = vi.fn()
    runAfterFirstPaint(new EventEmitter(), task)

    vi.advanceTimersByTime(4999)
    expect(task).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs the task once when the paint and the fallback both fire', () => {
    const win = new EventEmitter()
    const task = vi.fn()
    runAfterFirstPaint(win, task)

    win.emit('ready-to-show')
    vi.advanceTimersByTime(10_000)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
