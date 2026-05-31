// AudioWorkletProcessor that converts Float32 mono audio to Int16 LE
// and emits ~100ms batches to the main thread.
//
// Optional energy-gated VAD: when enabled, batches whose RMS is below the
// threshold are skipped, saving ~30% on streaming STT bandwidth (long pauses,
// muted speakers, ambient quiet). A short hangover after the last detected
// speech batch is kept so we don't clip the tail of words.
class PcmWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return []
  }

  constructor() {
    super()
    this.size = 1600 // 100ms at 16kHz
    this.batch = new Int16Array(this.size)
    this.offset = 0

    // VAD config — switched at runtime via port messages from micCapture, which
    // always sends vadThreshold + hangoverBatches. These literals are only a
    // fallback and MUST mirror src/shared/audio.ts (VAD_DEFAULT_THRESHOLD /
    // VAD_HANGOVER_BATCHES) — a static worklet module can't import from src/.
    this.vadEnabled = false
    this.vadThreshold = 0.005 // RMS in [0,1]; ~-46 dBFS — matches settings default
    this.hangoverBatches = 6 // ~600ms tail kept after last speech batch
    this.hangoverLeft = 0

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg && typeof msg === 'object') {
        if (typeof msg.vadEnabled === 'boolean') this.vadEnabled = msg.vadEnabled
        if (typeof msg.vadThreshold === 'number') this.vadThreshold = msg.vadThreshold
        if (typeof msg.hangoverBatches === 'number') this.hangoverBatches = msg.hangoverBatches
      }
    }
  }

  emitBatch() {
    let send = true
    if (this.vadEnabled) {
      // Energy-based VAD: compute RMS over the batch (in [0,1]).
      let sumSq = 0
      for (let i = 0; i < this.size; i++) {
        const v = this.batch[i] / 0x8000
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / this.size)
      if (rms >= this.vadThreshold) {
        this.hangoverLeft = this.hangoverBatches
      } else if (this.hangoverLeft > 0) {
        this.hangoverLeft -= 1
      } else {
        send = false
      }
    }

    if (send) {
      const buf = this.batch.buffer
      this.port.postMessage(buf, [buf])
      this.batch = new Int16Array(this.size)
    } else {
      // Reuse the buffer to avoid allocations during silence.
      this.batch.fill(0)
    }
    this.offset = 0
  }

  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.batch[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.offset >= this.size) this.emitBatch()
    }
    return true
  }
}

registerProcessor('pcm-worklet', PcmWorklet)
