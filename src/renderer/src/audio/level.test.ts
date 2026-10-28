import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachAnalyser, watchMicSilence } from './level'

function fakeMic(amplitude: () => number): { ctx: AudioContext; source: AudioNode } {
  const analyser = {
    fftSize: 0,
    getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
    getFloatTimeDomainData: (data: Float32Array) => data.fill(amplitude()),
    disconnect: () => {}
  }
  const ctx = { createAnalyser: () => analyser } as unknown as AudioContext
  const source = { connect: () => {} } as unknown as AudioNode
  return { ctx, source }
}

describe('watchMicSilence', () => {
  let detach: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    detach?.()
    detach = null
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('fires once when a muted mic stays at zero for the window', () => {
    const { ctx, source } = fakeMic(() => 0)
    detach = attachAnalyser(ctx, source)
    const onSilent = vi.fn()
    watchMicSilence(6_000, onSilent)
    vi.advanceTimersByTime(5_000)
    expect(onSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(onSilent).toHaveBeenCalledTimes(1)
  })

  it('stays quiet once the mic picks up any real signal', () => {
    let amp = 0
    const { ctx, source } = fakeMic(() => amp)
    detach = attachAnalyser(ctx, source)
    const onSilent = vi.fn()
    watchMicSilence(6_000, onSilent)
    vi.advanceTimersByTime(2_000)
    amp = 0.002
    vi.advanceTimersByTime(1_000)
    amp = 0
    vi.advanceTimersByTime(30_000)
    expect(onSilent).not.toHaveBeenCalled()
  })

  it('does nothing after it is cancelled', () => {
    const { ctx, source } = fakeMic(() => 0)
    detach = attachAnalyser(ctx, source)
    const onSilent = vi.fn()
    const cancel = watchMicSilence(6_000, onSilent)
    cancel()
    vi.advanceTimersByTime(30_000)
    expect(onSilent).not.toHaveBeenCalled()
  })
})
