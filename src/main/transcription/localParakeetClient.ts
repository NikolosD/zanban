import { randomUUID } from 'node:crypto'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import { speechWorker } from '../ml/index.js'
import type { MlTask } from '../ml/protocol.js'
import { trackJob } from '../services/jobsManager.js'

export interface LocalParakeetOptions {
  channel: AudioChannel
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const SAMPLE_RATE = 16_000
// Audio kept while the model loads (the first run downloads it); older audio is dropped.
const MAX_BACKLOG_SAMPLES = SAMPLE_RATE * 30
// The first run downloads ~670 MB.
const LOAD_TIMEOUT_MS = 30 * 60_000
// A phrase decodes in well under a second; the slack covers a reload after a worker restart.
const FEED_TIMEOUT_MS = 60_000

/**
 * Privacy-Mode STT with Parakeet v3 in the speech utility process. PCM is
 * streamed there as it arrives; voice activity detection cuts it at pauses and
 * each phrase comes back as one FINAL `TranscriptSegment`.
 */
export class LocalParakeetSttChannel {
  private readonly stream = randomUUID()
  private backlog: Float32Array = new Float32Array(0)
  // Audio dropped from the backlog; the worker times phrases from what it was sent.
  private droppedMs = 0
  private closed = false
  private ready = false
  private loadFailed = false
  private readonly loaded: Promise<boolean>
  // One request at a time, so phrases land in order.
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly opts: LocalParakeetOptions) {
    this.opts.onStatus({ kind: 'connecting', channel: opts.channel })
    this.loaded = trackJob('parakeet-load', 'Parakeet · loading speech model', 'pull', () =>
      speechWorker.request({ kind: 'load', model: 'parakeet' }, LOAD_TIMEOUT_MS, (progress) => {
        if (!this.closed)
          this.opts.onStatus({ kind: 'connecting', channel: opts.channel, progress })
      })
    ).then(
      () => {
        this.ready = true
        if (!this.closed) {
          this.opts.onStatus({ kind: 'open', channel: opts.channel })
          this.flushBacklog()
        }
        return true
      },
      (err: unknown) => {
        console.error('[parakeet-local] init failed', err)
        this.loadFailed = true
        this.backlog = new Float32Array(0)
        if (!this.closed) {
          this.opts.onStatus({
            kind: 'error',
            channel: opts.channel,
            message:
              'On-device speech model failed to load. Check the connection for its first download.'
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

    if (this.ready) {
      this.feed(f32)
      return
    }
    const merged = new Float32Array(this.backlog.length + f32.length)
    merged.set(this.backlog, 0)
    merged.set(f32, this.backlog.length)
    const excess = merged.length - MAX_BACKLOG_SAMPLES
    this.backlog = excess > 0 ? merged.slice(excess) : merged
    if (excess > 0) this.droppedMs += Math.round((excess / SAMPLE_RATE) * 1000)
  }

  close(): void {
    this.closed = true
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
    // The backlog and the phrase still being spoken carry the last words of the
    // call; the session manager files them under the session they were captured in.
    void this.loaded.then((ok) => {
      if (!ok) return
      this.flushBacklog()
      this.enqueue({ kind: 'speechEnd', stream: this.stream })
    })
  }

  private flushBacklog(): void {
    if (this.backlog.length > 0) this.feed(this.backlog)
    this.backlog = new Float32Array(0)
  }

  private feed(samples: Float32Array): void {
    this.enqueue({ kind: 'speechFeed', stream: this.stream, samples })
  }

  private enqueue(task: Extract<MlTask, { kind: 'speechFeed' | 'speechEnd' }>): void {
    this.queue = this.queue.then(async () => {
      try {
        const phrases = await speechWorker.request(task, FEED_TIMEOUT_MS)
        for (const phrase of phrases) {
          this.opts.onSegment({
            id: randomUUID(),
            channel: this.opts.channel,
            speaker: this.opts.channel === 'mic' ? 0 : 1,
            startMs: this.droppedMs + phrase.startMs,
            endMs: this.droppedMs + phrase.endMs,
            text: phrase.text,
            isFinal: true,
            createdAt: Date.now()
          })
        }
      } catch (err) {
        console.error('[parakeet-local] recognize failed', err)
      }
    })
  }
}
