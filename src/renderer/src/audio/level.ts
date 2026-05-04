// Tiny pub-sub for live mic peak level (0..1). The worklet is busy producing
// chunks for Deepgram; this module taps the same MediaStream via an
// AnalyserNode in a separate AudioContext so it's independent.

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

export function attachAnalyser(stream: MediaStream): () => void {
  // Use a fresh AudioContext to avoid stepping on the worklet's context.
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
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
      source.disconnect()
      a.disconnect()
      void ctx.close()
    } catch {
      /* ignore */
    }
    analyser = null
    timeData = null
    current = 0
    for (const cb of listeners) cb(0)
  }
}
