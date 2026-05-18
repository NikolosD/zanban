import { randomUUID } from 'node:crypto'
import {
  AudioFormat,
  CommitStrategy,
  ElevenLabsClient,
  RealtimeEvents,
  type RealtimeConnection
} from '@elevenlabs/elevenlabs-js'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import { pcm16ToBase64 } from './pcmUtils.js'

export interface ElevenLabsSttOptions {
  apiKey: string
  channel: AudioChannel
  language: string
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const SAMPLE_RATE = 16_000
const MODEL_ID = 'scribe_v2_realtime'
const MAX_RETRIES = 10

/**
 * ElevenLabs Scribe v2 Realtime STT — streaming transcription over a WebSocket
 * via the official SDK. Server-side VAD commits utterances automatically, so
 * the UI sees interim (`partial`) text while someone is speaking and a final
 * segment once they pause. Mirrors the connect/reconnect lifecycle of the
 * Deepgram client.
 */
export class ElevenLabsSttChannel {
  private connection: RealtimeConnection | null = null
  private closed = false
  private ready = false
  private retries = 0
  private retryTimer: NodeJS.Timeout | null = null
  private reconnectScheduled = false
  // Audio that arrived before the socket finished opening — replayed on open
  // so the first words of speech aren't swallowed during connect/reconnect.
  private pending: Int16Array[] = []
  // Monotonic count of audio milliseconds streamed, used to stamp segments.
  private offsetMs = 0
  private committedMs = 0

  constructor(private readonly opts: ElevenLabsSttOptions) {
    if (!opts.apiKey) {
      opts.onStatus({
        kind: 'error',
        channel: opts.channel,
        message: 'ElevenLabs API key not set. Open Settings → Providers.'
      })
      this.closed = true
      return
    }
    void this.connect()
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed) return
    const samples = new Int16Array(buffer)
    this.offsetMs += Math.round((samples.length / SAMPLE_RATE) * 1000)
    if (this.connection && this.ready) {
      this.pushAudio(samples)
    } else if (this.pending.length < 25) {
      this.pending.push(samples)
    }
  }

  close(): void {
    this.closed = true
    this.ready = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      this.connection?.close()
    } catch {
      /* ignore */
    }
    this.connection = null
    this.pending = []
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
  }

  private pushAudio(samples: Int16Array): void {
    try {
      this.connection?.send({ audioBase64: pcm16ToBase64(samples) })
    } catch (err) {
      console.warn(`[elevenlabs:${this.opts.channel}] send failed`, err)
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    this.opts.onStatus({ kind: 'connecting', channel: this.opts.channel })

    try {
      const client = new ElevenLabsClient({ apiKey: this.opts.apiKey })
      const language = this.opts.language
      const conn = await client.speechToText.realtime.connect({
        modelId: MODEL_ID,
        audioFormat: AudioFormat.PCM_16000,
        sampleRate: SAMPLE_RATE,
        commitStrategy: CommitStrategy.VAD,
        ...(language && language !== 'multi' ? { languageCode: language } : {})
      })
      if (this.closed) {
        conn.close()
        return
      }
      this.connection = conn
      this.ready = true
      this.retries = 0
      console.log(`[elevenlabs:${this.opts.channel}] open (model=${MODEL_ID})`)
      this.opts.onStatus({ kind: 'open', channel: this.opts.channel })

      conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (msg) => {
        this.emit(msg.text, false)
      })
      conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (msg) => {
        this.emit(msg.text, true)
        this.committedMs = this.offsetMs
      })
      conn.on(RealtimeEvents.ERROR, (err) => {
        const message = err instanceof Error ? err.message : (err?.error ?? 'unknown error')
        console.error(`[elevenlabs:${this.opts.channel}] error`, message)
        this.opts.onStatus({ kind: 'error', channel: this.opts.channel, message })
        this.ready = false
        if (!this.closed) this.scheduleReconnect()
      })
      conn.on(RealtimeEvents.CLOSE, () => {
        console.log(`[elevenlabs:${this.opts.channel}] closed`)
        this.ready = false
        if (!this.closed) this.scheduleReconnect()
      })

      // Replay audio buffered while the socket was opening.
      for (const samples of this.pending) this.pushAudio(samples)
      this.pending = []
    } catch (err) {
      console.error(`[elevenlabs:${this.opts.channel}] connect failed`, err)
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: err instanceof Error ? err.message : 'connect failed'
      })
      this.scheduleReconnect()
    }
  }

  private emit(rawText: string, isFinal: boolean): void {
    const text = rawText.trim()
    if (!text) return
    this.opts.onSegment({
      id: randomUUID(),
      channel: this.opts.channel,
      speaker: this.opts.channel === 'mic' ? 0 : 1,
      startMs: this.committedMs,
      endMs: this.offsetMs,
      text,
      isFinal,
      createdAt: Date.now()
    })
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectScheduled) return
    this.reconnectScheduled = true
    this.retries += 1
    if (this.retries > MAX_RETRIES) {
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: 'reconnect attempts exhausted'
      })
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** (this.retries - 1))
    this.retryTimer = setTimeout(() => {
      this.reconnectScheduled = false
      void this.connect()
    }, delay)
  }
}
