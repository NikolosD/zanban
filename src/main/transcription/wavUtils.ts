/**
 * Wrap raw PCM16 LE samples in a minimal RIFF/WAV header so providers that
 * expect a "file" (ElevenLabs / OpenAI batch endpoints) can accept what is
 * effectively a streaming audio buffer.
 */
export function pcm16ToWav(pcm: Int16Array, sampleRate = 16_000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2
  const blockAlign = channels * 2
  const dataSize = pcm.byteLength
  const buf = Buffer.alloc(44 + dataSize)
  // RIFF header
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  // fmt subchunk
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // subchunk1Size for PCM
  buf.writeUInt16LE(1, 20) // PCM format
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(16, 34) // bits per sample
  // data subchunk
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, 44)
  return buf
}
