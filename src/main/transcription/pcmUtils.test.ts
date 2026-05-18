import { describe, expect, it } from 'vitest'
import { pcm16ToBase64, resamplePcm16 } from './pcmUtils.js'

// Node pools small Buffers, so a decoded Buffer's `.buffer` can be larger than
// its contents — decode through the Buffer's own byte range.
function decodePcm16(base64: string): Int16Array {
  const buf = Buffer.from(base64, 'base64')
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
}

describe('pcm16ToBase64', () => {
  it('round-trips PCM16 samples through base64', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234])
    expect(Array.from(decodePcm16(pcm16ToBase64(pcm)))).toEqual(Array.from(pcm))
  })

  it('encodes only the sample range of a subarray', () => {
    const full = new Int16Array([10, 20, 30, 40])
    const slice = full.subarray(1, 3)
    expect(Array.from(decodePcm16(pcm16ToBase64(slice)))).toEqual([20, 30])
  })
})

describe('resamplePcm16', () => {
  it('returns the input untouched when rates match', () => {
    const pcm = new Int16Array([1, 2, 3])
    expect(resamplePcm16(pcm, 16_000, 16_000)).toBe(pcm)
  })

  it('returns an empty array unchanged', () => {
    const pcm = new Int16Array(0)
    expect(resamplePcm16(pcm, 16_000, 24_000)).toBe(pcm)
  })

  it('upsamples 16kHz to 24kHz with the expected length', () => {
    const pcm = new Int16Array(160)
    const out = resamplePcm16(pcm, 16_000, 24_000)
    expect(out.length).toBe(240)
  })

  it('downsamples 24kHz to 16kHz with the expected length', () => {
    const pcm = new Int16Array(240)
    const out = resamplePcm16(pcm, 24_000, 16_000)
    expect(out.length).toBe(160)
  })

  it('preserves the first sample and stays within signal bounds', () => {
    const pcm = new Int16Array([100, 200, 300, 400])
    const out = resamplePcm16(pcm, 16_000, 24_000)
    expect(out[0]).toBe(100)
    for (const s of out) {
      expect(s).toBeGreaterThanOrEqual(100)
      expect(s).toBeLessThanOrEqual(400)
    }
  })
})
