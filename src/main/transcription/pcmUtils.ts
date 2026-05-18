/**
 * Shared PCM helpers for the streaming STT clients. Audio capture emits 16 kHz
 * signed 16-bit little-endian mono PCM (see pcm-worklet.js); realtime providers
 * want it base64-encoded, and some (OpenAI) want a different sample rate.
 */

/** Encode raw PCM16 LE samples as a base64 string for JSON transport. */
export function pcm16ToBase64(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
}

/**
 * Resample PCM16 between sample rates with linear interpolation. Used to lift
 * the app's 16 kHz capture up to the 24 kHz that OpenAI's realtime `pcm16`
 * format expects. Returns the input untouched when the rates already match.
 */
export function resamplePcm16(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || pcm.length === 0) return pcm
  const outLength = Math.round((pcm.length * toRate) / fromRate)
  const out = new Int16Array(outLength)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, pcm.length - 1)
    const frac = srcPos - i0
    const a = pcm[i0] ?? 0
    const b = pcm[i1] ?? 0
    out[i] = Math.round(a * (1 - frac) + b * frac)
  }
  return out
}
