import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LivenessWatchdog, STALL_TIMEOUT_MS } from './livenessWatchdog'

describe('LivenessWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stalls once audio goes unanswered for the timeout', () => {
    const onStall = vi.fn()
    const dog = new LivenessWatchdog(onStall)
    dog.start()
    dog.noteSent()
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1)
    dog.noteSent()
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)
    expect(onStall).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('never stalls while the server keeps answering', () => {
    const onStall = vi.fn()
    const dog = new LivenessWatchdog(onStall)
    dog.start()
    for (let i = 0; i < 20; i++) {
      dog.noteSent()
      vi.advanceTimersByTime(3_000)
      dog.noteHeard()
    }
    expect(onStall).not.toHaveBeenCalled()
  })

  it('does not stall on silence when nothing is being sent', () => {
    const onStall = vi.fn()
    const dog = new LivenessWatchdog(onStall)
    dog.start()
    vi.advanceTimersByTime(120_000)
    expect(onStall).not.toHaveBeenCalled()
  })

  it('treats unanswered probes as a stall even without audio', () => {
    const onStall = vi.fn()
    const probe = vi.fn()
    const dog = new LivenessWatchdog(onStall, probe)
    dog.start()
    vi.advanceTimersByTime(STALL_TIMEOUT_MS + 5_000)
    expect(probe).toHaveBeenCalled()
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('keeps a quiet socket alive when probes are answered', () => {
    const onStall = vi.fn()
    const dog = new LivenessWatchdog(onStall, () => {})
    dog.start()
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(5_000)
      dog.noteHeard()
    }
    expect(onStall).not.toHaveBeenCalled()
  })

  it('stops checking after stop()', () => {
    const onStall = vi.fn()
    const dog = new LivenessWatchdog(onStall)
    dog.start()
    dog.noteSent()
    dog.stop()
    vi.advanceTimersByTime(STALL_TIMEOUT_MS * 3)
    expect(onStall).not.toHaveBeenCalled()
  })
})
