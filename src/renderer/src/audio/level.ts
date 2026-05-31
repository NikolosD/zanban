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
