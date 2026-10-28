import { randomUUID } from 'node:crypto'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import { mlWorker } from '../ml/index.js'
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
// Audio kept while the model loads (the first run downloads it); older audio is dropped.
const MAX_BACKLOG_SAMPLES = SAMPLE_RATE * 30
const LOAD_TIMEOUT_MS = 10 * 60_000
// A batch decodes in under a second; the slack covers a reload after a worker restart.
const RECOGNIZE_TIMEOUT_MS = 60_000

/**
 * Privacy-Mode STT: 5-second batches of 16 kHz PCM are decoded with Whisper-tiny
 * via @xenova/transformers (ONNX, on-device) in the ML utility process. Not
 * real-time, but no audio ever leaves the machine.
 *
 * Each batch produces a single FINAL `TranscriptSegment` — no interim partials.
 */
export class LocalWhisperSttChannel {
  private buf: Float32Array = new Float32Array(0)
  private closed = false
  private offsetMs = 0
  private ready = false
  private loadFailed = false
  private readonly loaded: Promise<boolean>
  // One batch at a time, so segments land in order even when the backlog from
  // the model load is dispatched all at once.
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly opts: LocalWhisperOptions) {
    this.opts.onStatus({ kind: 'connecting', channel: opts.channel })
    this.loaded = mlWorker.request({ kind: 'load', model: 'whisper' }, LOAD_TIMEOUT_MS).then(
      () => {
        this.ready = true
        if (!this.closed) {
          this.opts.onStatus({ kind: 'open', channel: opts.channel })
          this.dispatchChunks()
        }
        return true
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
        return false
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

    if (this.ready) {
      this.dispatchChunks()
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
    void this.loaded.then((ok) => {
      if (!ok) return
      this.dispatchChunks()
      // Flush tail (>500 ms) so the last words aren't lost on Stop.
      if (this.buf.length > SAMPLE_RATE / 2) this.enqueue(this.buf)
      this.buf = new Float32Array(0)
    })
  }

  private dispatchChunks(): void {
    while (this.buf.length >= SAMPLES_PER_CHUNK) {
      this.enqueue(this.buf.slice(0, SAMPLES_PER_CHUNK))
      this.buf = this.buf.slice(SAMPLES_PER_CHUNK)
    }
  }

  private enqueue(samples: Float32Array): void {
    const startMs = this.offsetMs
    this.offsetMs += Math.round((samples.length / SAMPLE_RATE) * 1000)
    const endMs = this.offsetMs
    this.queue = this.queue.then(() => this.recognize(samples, startMs, endMs))
  }

  private async recognize(samples: Float32Array, startMs: number, endMs: number): Promise<void> {
    try {
      await trackJob(
        `whisper-local-${randomUUID()}`,
        `Whisper · ${this.opts.channel} · ${(samples.length / SAMPLE_RATE).toFixed(1)}s`,
        'other',
        async () => {
          const text = await mlWorker.request(
            {
              kind: 'transcribe',
              samples,
              language: this.opts.language === 'multi' ? undefined : this.opts.language,
              chunkSeconds: CHUNK_SECONDS
            },
            RECOGNIZE_TIMEOUT_MS
          )
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
