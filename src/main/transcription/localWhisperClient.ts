import { randomUUID } from 'node:crypto'
import type {
  AudioChannel,
  TranscriptSegment,
  TranscriptionStatus
} from '../../shared/types.js'
import { trackJob } from '../services/jobsManager.js'

export interface LocalWhisperOptions {
  language: string
  channel: AudioChannel
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const SAMPLE_RATE = 16_000
const CHUNK_SECONDS = 5
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS

type Asr = (
  input: Float32Array,
  opts?: { language?: string; task?: string; chunk_length_s?: number }
) => Promise<{ text?: string }>

let asrPromise: Promise<Asr | null> | null = null

async function getAsr(): Promise<Asr | null> {
  if (asrPromise) return asrPromise
  asrPromise = (async () => {
    try {
      const mod = await import('@xenova/transformers')
      const { pipeline } = mod as unknown as {
        pipeline: (task: string, model: string) => Promise<Asr>
      }
      // Whisper-tiny is the smallest supported variant (~70 MB).
      // Trade quality for footprint — Privacy Mode users opt in knowingly.
      return await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny')
    } catch (err) {
      console.error('[whisper-local] init failed', err)
      return null
    }
  })()
  return asrPromise
}

/**
 * Privacy-Mode STT: 5-second batches of 16 kHz PCM are decoded with Whisper-tiny
 * via @xenova/transformers (ONNX, on-device). Not real-time, but no audio ever
 * leaves the machine.
 *
 * Each batch produces a single FINAL `TranscriptSegment` — no interim partials.
 */
export class LocalWhisperSttChannel {
  private buf: Float32Array = new Float32Array(0)
  private closed = false
  private offsetMs = 0
  private asrReady = false

  constructor(private readonly opts: LocalWhisperOptions) {
    this.opts.onStatus({ kind: 'connecting', channel: opts.channel })
    void getAsr().then((asr) => {
      if (this.closed) return
      if (!asr) {
        this.opts.onStatus({
          kind: 'error',
          channel: opts.channel,
          message: 'Local Whisper failed to load. Check Privacy Mode requirements.'
        })
        return
      }
      this.asrReady = true
      this.opts.onStatus({ kind: 'open', channel: opts.channel })
    })
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed || !this.asrReady) return
    // pcm-worklet emits Int16 LE batches; convert to Float32 [-1, 1].
    const i16 = new Int16Array(buffer)
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = (i16[i] ?? 0) / 0x8000

    const merged = new Float32Array(this.buf.length + f32.length)
    merged.set(this.buf, 0)
    merged.set(f32, this.buf.length)
    this.buf = merged

    if (this.buf.length >= SAMPLES_PER_CHUNK) {
      const chunk = this.buf.slice(0, SAMPLES_PER_CHUNK)
      this.buf = this.buf.slice(SAMPLES_PER_CHUNK)
      void this.recognize(chunk)
    }
  }

  close(): void {
    this.closed = true
    if (this.buf.length > SAMPLE_RATE / 2) {
      // Flush tail (>500 ms) so the last words aren't lost on Stop.
      void this.recognize(this.buf)
    }
    this.buf = new Float32Array(0)
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
  }

  private async recognize(samples: Float32Array): Promise<void> {
    const asr = await getAsr()
    if (!asr || this.closed) return
    const startMs = this.offsetMs
    this.offsetMs += Math.round((samples.length / SAMPLE_RATE) * 1000)
    try {
      await trackJob(
        `whisper-local-${randomUUID()}`,
        `Whisper · ${this.opts.channel} · ${(samples.length / SAMPLE_RATE).toFixed(1)}s`,
        'other',
        async () => {
          const r = await asr(samples, {
            language: this.opts.language === 'multi' ? undefined : this.opts.language,
            task: 'transcribe',
            chunk_length_s: CHUNK_SECONDS
          })
          const text = (r.text ?? '').trim()
          if (!text) return
          const seg: TranscriptSegment = {
            id: randomUUID(),
            channel: this.opts.channel,
            speaker: this.opts.channel === 'mic' ? 0 : 1,
            startMs,
            endMs: this.offsetMs,
            text,
            isFinal: true,
            createdAt: Date.now()
          }
          this.opts.onSegment(seg)
        }
      )
    } catch (err) {
      console.error('[whisper-local] recognize failed', err)
    }
  }
}
