import { randomUUID } from 'node:crypto'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import { IdleResource } from '../services/idleResource.js'
import { trackJob } from '../services/jobsManager.js'
import { loadTransformers, type TransformersPipeline } from '../services/transformers.js'

export interface LocalWhisperOptions {
  language: string
  channel: AudioChannel
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const SAMPLE_RATE = 16_000
const CHUNK_SECONDS = 5
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS
// Audio kept while the model loads (the first run downloads it); older audio is dropped.
const MAX_BACKLOG_SAMPLES = SAMPLE_RATE * 30

type Asr = TransformersPipeline &
  ((
    input: Float32Array,
    opts?: { language?: string; task?: string; chunk_length_s?: number }
  ) => Promise<{ text?: string }>)

// Held by every open channel until its last batch is transcribed, then disposed
// at once: nothing else uses the model between calls.
const whisper = new IdleResource<Asr>({
  load: async () => {
    const { pipeline } = await loadTransformers()
    // Whisper-tiny is the smallest supported variant (~70 MB).
    // Trade quality for footprint — Privacy Mode users opt in knowingly.
    return (await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny')) as Asr
  },
  dispose: (asr) => asr.dispose(),
  idleMs: 0
})

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
  private asr: Asr | null = null
  private loadFailed = false
  private readonly loaded: Promise<Asr | null>
  // One batch at a time, so segments land in order even when the backlog from
  // the model load is dispatched all at once.
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly opts: LocalWhisperOptions) {
    this.opts.onStatus({ kind: 'connecting', channel: opts.channel })
    this.loaded = whisper.acquire().then(
      (asr) => {
        this.asr = asr
        if (!this.closed) {
          this.opts.onStatus({ kind: 'open', channel: opts.channel })
          this.dispatchChunks(asr)
        }
        return asr
      },
      (err: unknown) => {
        console.error('[whisper-local] init failed', err)
        this.loadFailed = true
        this.buf = new Float32Array(0)
        if (!this.closed) {
          this.opts.onStatus({
            kind: 'error',
            channel: opts.channel,
            message: 'Local Whisper failed to load. Check Privacy Mode requirements.'
          })
        }
        return null
      }
    )
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed || this.loadFailed) return
    // pcm-worklet emits Int16 LE batches; convert to Float32 [-1, 1].
    const i16 = new Int16Array(buffer)
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = (i16[i] ?? 0) / 0x8000

    const merged = new Float32Array(this.buf.length + f32.length)
    merged.set(this.buf, 0)
    merged.set(f32, this.buf.length)
    this.buf = merged

    if (this.asr) {
      this.dispatchChunks(this.asr)
      return
    }
    const excess = this.buf.length - MAX_BACKLOG_SAMPLES
    if (excess > 0) {
      this.buf = this.buf.slice(excess)
      this.offsetMs += Math.round((excess / SAMPLE_RATE) * 1000)
    }
  }

  close(): void {
    this.closed = true
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
    // In-flight batches, the load backlog and the tail run to completion after
    // close(): they carry the last words of the call, and the session manager
    // files them under the session they were captured in.
    void this.loaded.then(async (asr) => {
      if (!asr) return
      this.dispatchChunks(asr)
      // Flush tail (>500 ms) so the last words aren't lost on Stop.
      if (this.buf.length > SAMPLE_RATE / 2) this.enqueue(asr, this.buf)
      this.buf = new Float32Array(0)
      await this.queue
      whisper.release()
    })
  }

  private dispatchChunks(asr: Asr): void {
    while (this.buf.length >= SAMPLES_PER_CHUNK) {
      this.enqueue(asr, this.buf.slice(0, SAMPLES_PER_CHUNK))
      this.buf = this.buf.slice(SAMPLES_PER_CHUNK)
    }
  }

  private enqueue(asr: Asr, samples: Float32Array): void {
    const startMs = this.offsetMs
    this.offsetMs += Math.round((samples.length / SAMPLE_RATE) * 1000)
    const endMs = this.offsetMs
    this.queue = this.queue.then(() => this.recognize(asr, samples, startMs, endMs))
  }

  private async recognize(
    asr: Asr,
    samples: Float32Array,
    startMs: number,
    endMs: number
  ): Promise<void> {
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
            endMs,
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
