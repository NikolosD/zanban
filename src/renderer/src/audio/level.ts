// Tiny pub-sub for live mic peak level (0..1). The worklet is busy producing
// chunks for the STT provider; this module taps the SAME AudioContext + source
// node via an AnalyserNode. It deliberately does NOT open its own AudioContext:
// two contexts at different sample rates on one mic device caused silent
// capture on some Windows drivers — see [[mic-missing-from-saved-transcript]].

type Listener = (level: number) => void

const listeners = new Set<Listener>()
let current = 0

export function getLevel(): number {
  return current
}

export function onLevel(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let raf = 0
let analyser: AnalyserNode | null = null
let timeData: Uint8Array | null = null

export function attachAnalyser(ctx: AudioContext, source: AudioNode): () => void {
  const a = ctx.createAnalyser()
  a.fftSize = 1024
  source.connect(a)
  analyser = a
  timeData = new Uint8Array(a.fftSize)

  const tick = (): void => {
    if (!analyser || !timeData) return
    analyser.getByteTimeDomainData(timeData as unknown as Uint8Array<ArrayBuffer>)
    let peak = 0
    for (let i = 0; i < timeData.length; i++) {
      const sample = timeData[i] ?? 128
      const v = Math.abs(sample - 128) / 128
      if (v > peak) peak = v
    }
    current = peak
    for (const cb of listeners) cb(peak)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(raf)
    try {
      // Only disconnect our analyser tap — the shared ctx + source are owned by
      // the capture pipeline and must stay alive for the worklet.
      a.disconnect()
    } catch {
      /* ignore */
    }
    analyser = null
    timeData = null
    current = 0
    for (const cb of listeners) cb(0)
  }
}

// ~-70 dBFS: under any real room's noise floor, so only a muted or dead mic
// (digital zeros, dither) stays below it. Needs float samples — the meter's
// 8-bit ones read a quiet room as exact zero.
const SILENT_PEAK = 0.0003
const SILENCE_POLL_MS = 200

/**
 * Calls `onSilent` once if the mic peak never rises above SILENT_PEAK within
 * `windowMs`. Polls the analyser on a timer instead of reading the meter: the
 * meter runs on rAF, which stalls while the dashboard window is hidden. Gives
 * up quietly if the mic goes away. Returns a cancel function.
 */
export function watchMicSilence(windowMs: number, onSilent: () => void): () => void {
  const startedAt = Date.now()
  let samples: Float32Array<ArrayBuffer> | null = null
  const timer = setInterval(() => {
    const a = analyser
    if (!a) {
      clearInterval(timer)
      return
    }
    if (samples?.length !== a.fftSize) samples = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(samples)
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    if (peak >= SILENT_PEAK) {
      clearInterval(timer)
    } else if (Date.now() - startedAt >= windowMs) {
      clearInterval(timer)
      onSilent()
    }
  }, SILENCE_POLL_MS)
  return () => clearInterval(timer)
}
