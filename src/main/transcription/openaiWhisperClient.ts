import { randomUUID } from 'node:crypto'
import type {
  AudioChannel,
  TranscriptSegment,
  TranscriptionStatus
} from '../../shared/types.js'
import { trackJob } from '../services/jobsManager.js'
import { pcm16ToWav } from './wavUtils.js'

export interface OpenAiWhisperOptions {
  apiKey: string
  channel: AudioChannel
  language: string
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const SAMPLE_RATE = 16_000
const CHUNK_SECONDS = 8
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS
const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

/**
 * OpenAI Whisper STT — batch mode (8-sec chunks via /v1/audio/transcriptions
 * with `whisper-1` or `gpt-4o-transcribe`). Not a true streaming socket; for
 * lowest latency use Deepgram. This trades ~2-3 s of latency for setup
 * simplicity (one API key, no socket bookkeeping).
 */
export class OpenAiWhisperSttChannel {
  private buf = new Int16Array(0)
  private offsetMs = 0
  private closed = false

  constructor(private readonly opts: OpenAiWhisperOptions) {
    if (!opts.apiKey) {
      opts.onStatus({
        kind: 'error',
        channel: opts.channel,
        message: 'OpenAI API key not set. Open Settings → Providers.'
      })
      this.closed = true
      return
    }
    opts.onStatus({ kind: 'open', channel: opts.channel })
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed) return
    const incoming = new Int16Array(buffer)
    const merged = new Int16Array(this.buf.length + incoming.length)
    merged.set(this.buf, 0)
    merged.set(incoming, this.buf.length)
    this.buf = merged

    if (this.buf.length >= SAMPLES_PER_CHUNK) {
      const chunk = this.buf.slice(0, SAMPLES_PER_CHUNK)
      this.buf = this.buf.slice(SAMPLES_PER_CHUNK)
      void this.transcribe(chunk)
    }
  }

  close(): void {
    this.closed = true
    if (this.buf.length > SAMPLE_RATE / 2) void this.transcribe(this.buf)
    this.buf = new Int16Array(0)
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
  }

  private async transcribe(samples: Int16Array): Promise<void> {
    const startMs = this.offsetMs
    this.offsetMs += Math.round((samples.length / SAMPLE_RATE) * 1000)
    await trackJob(
      `openai-whisper-${randomUUID()}`,
      `OpenAI Whisper · ${this.opts.channel}`,
      'other',
      async () => {
        try {
          const wav = pcm16ToWav(samples, SAMPLE_RATE, 1)
          const blob = new Blob([wav], { type: 'audio/wav' })
          const form = new FormData()
          form.append('file', blob, 'chunk.wav')
          form.append('model', 'whisper-1')
          if (this.opts.language && this.opts.language !== 'multi') {
            form.append('language', this.opts.language)
          }
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { authorization: `Bearer ${this.opts.apiKey}` },
            body: form
          })
          if (!res.ok) {
            console.warn('[openai-whisper] HTTP', res.status, await res.text())
            return
          }
          const data = (await res.json()) as { text?: string }
          const text = (data.text ?? '').trim()
          if (!text) return
          this.opts.onSegment({
            id: randomUUID(),
            channel: this.opts.channel,
            speaker: this.opts.channel === 'mic' ? 0 : 1,
            startMs,
            endMs: this.offsetMs,
            text,
            isFinal: true,
            createdAt: Date.now()
          })
        } catch (err) {
          console.error('[openai-whisper] failed', err)
        }
      }
    )
  }
}
