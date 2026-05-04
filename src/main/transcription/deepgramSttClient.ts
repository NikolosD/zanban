import { DeepgramClient } from '@deepgram/sdk'
import { randomUUID } from 'node:crypto'
import type {
  AudioChannel,
  TranscriptSegment,
  TranscriptionStatus
} from '../../shared/types.js'

export interface DeepgramSttChannelOptions {
  apiKey: string
  language: string
  channel: AudioChannel
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

// Map our shared language codes to Deepgram's accepted values. Nova-3 takes
// `multi` for code-switching and ISO codes for pinned languages.
const LANGUAGE_CODES: Record<string, string> = {
  multi: 'multi',
  en: 'en',
  ru: 'multi', // Nova-3 only exposes Russian via the multi-lingual model.
  es: 'multi',
  de: 'multi',
  fr: 'multi',
  it: 'multi',
  pt: 'multi',
  ja: 'multi',
  ko: 'multi',
  zh: 'multi'
}

function resolveLanguage(lang: string): string {
  return LANGUAGE_CODES[lang] ?? 'multi'
}

const KEEPALIVE_MS = 8_000
const MAX_RETRIES = 10

interface DgResult {
  type?: string
  channel?: {
    alternatives?: Array<{ transcript?: string | null }>
  }
  is_final?: boolean
  speech_final?: boolean
  start?: number
  duration?: number
}

interface DgConnection {
  on(event: 'open' | 'message' | 'error' | 'close', cb: (payload: unknown) => void): void
  connect(): void
  waitForOpen(): Promise<void>
  sendMedia(data: Buffer | ArrayBuffer): void
  sendKeepAlive(payload: { type: 'KeepAlive' }): void
  close(): void
}

export class DeepgramSttChannel {
  private opts: DeepgramSttChannelOptions
  private connection: DgConnection | null = null
  private closed = false
  private ready = false
  private retries = 0
  private retryTimer: NodeJS.Timeout | null = null
  private keepAliveTimer: NodeJS.Timeout | null = null
  private reconnectScheduled = false
  // Audio chunks dropped because the socket isn't ready yet — Deepgram closes
  // the stream if it sits idle, so we buffer briefly and replay on `open` so
  // the first second of speech doesn't get swallowed during reconnect.
  private pending: Buffer[] = []
  private droppedCount = 0
  private sentCount = 0

  constructor(opts: DeepgramSttChannelOptions) {
    this.opts = opts
    void this.connect()
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed) return
    const buf = Buffer.from(buffer)
    if (this.connection && this.ready) {
      try {
        this.connection.sendMedia(buf)
        this.sentCount += 1
        if (this.sentCount === 1 || this.sentCount % 50 === 0) {
          console.log(
            `[deepgram:${this.opts.channel}] sent chunk #${this.sentCount} (dropped=${this.droppedCount})`
          )
        }
      } catch (err) {
        console.warn(`[deepgram:${this.opts.channel}] send failed`, err)
      }
    } else {
      // Bound the buffer — at 16kHz/16bit/mono PCM, 25 chunks of 4 KB ≈ 3 s
      // of audio. Past that we drop, otherwise a long disconnect would queue
      // up minutes of stale audio that's no longer useful.
      if (this.pending.length < 25) this.pending.push(buf)
      else this.droppedCount += 1
    }
  }

  close(): void {
    this.closed = true
    this.ready = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
    try {
      this.connection?.close()
    } catch {
      /* ignore */
    }
    this.connection = null
    this.pending = []
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    if (!this.opts.apiKey) {
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: 'Deepgram API key required'
      })
      return
    }

    this.opts.onStatus({ kind: 'connecting', channel: this.opts.channel })

    try {
      const client = new DeepgramClient({ apiKey: this.opts.apiKey })
      const language = resolveLanguage(this.opts.language)
      // Nova-3 is the latest streaming model — multilingual, low-latency,
      // beats Nova-2 on accuracy. `interim_results: true` mirrors what we
      // get from Google STT so the UI updates while someone is mid-sentence.
      // Booleans must be passed as strings in v5.
      const params = {
        model: 'nova-3',
        language,
        punctuate: 'true',
        interim_results: 'true',
        smart_format: 'true',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1'
      }

      const conn = (await (
        client.listen as unknown as {
          v1: { connect(p: typeof params): Promise<DgConnection> }
        }
      ).v1.connect(params)) as DgConnection

      this.connection = conn

      conn.on('open', () => {
        this.ready = true
        this.retries = 0
        console.log(
          `[deepgram:${this.opts.channel}] open (model=nova-3, language=${language})`
        )
        this.opts.onStatus({ kind: 'open', channel: this.opts.channel })
        // Replay buffered audio that arrived while the socket was opening.
        for (const buf of this.pending) {
          try {
            conn.sendMedia(buf)
          } catch {
            /* ignore */
          }
        }
        this.pending = []
        // Deepgram closes idle sockets after ~12s. Pinging KeepAlive every
        // 8s keeps the WebSocket warm during long silent stretches in the
        // call (think notes, mute pauses).
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
        this.keepAliveTimer = setInterval(() => {
          if (this.ready && this.connection) {
            try {
              this.connection.sendKeepAlive({ type: 'KeepAlive' })
            } catch {
              /* ignore */
            }
          }
        }, KEEPALIVE_MS)
      })

      conn.on('message', (raw) => {
        const data = raw as DgResult
        if (data.type !== 'Results') return
        const text = data.channel?.alternatives?.[0]?.transcript?.trim()
        if (!text) return
        const isFinal = !!data.is_final
        const startSec = Number(data.start ?? 0)
        const durSec = Number(data.duration ?? 0)
        const startMs = Math.round(startSec * 1000)
        const endMs = Math.round((startSec + durSec) * 1000)
        console.log(
          `[deepgram:${this.opts.channel}] final=${isFinal} text="${text}"`
        )
        this.opts.onSegment({
          id: randomUUID(),
          channel: this.opts.channel,
          speaker: 0,
          startMs,
          endMs,
          text,
          isFinal,
          createdAt: Date.now()
        })
      })

      conn.on('error', (raw) => {
        const err = raw as { message?: string } | Error
        const message = err instanceof Error ? err.message : err?.message ?? 'unknown'
        console.error(`[deepgram:${this.opts.channel}] error`, message)
        this.opts.onStatus({
          kind: 'error',
          channel: this.opts.channel,
          message
        })
        this.ready = false
        if (!this.closed) this.scheduleReconnect()
      })

      conn.on('close', () => {
        console.log(`[deepgram:${this.opts.channel}] closed`)
        this.ready = false
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
        this.keepAliveTimer = null
        this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
        if (!this.closed) this.scheduleReconnect()
      })

      conn.connect()
      await conn.waitForOpen()
    } catch (err) {
      console.error(`[deepgram:${this.opts.channel}] connect failed`, err)
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: err instanceof Error ? err.message : 'connect failed'
      })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    if (this.reconnectScheduled) return
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
    // 1s, 2s, 4s … capped at 30s — matches the curve Natively uses.
    const delay = Math.min(30_000, 1_000 * 2 ** (this.retries - 1))
    this.retryTimer = setTimeout(() => {
      this.reconnectScheduled = false
      void this.connect()
    }, delay)
  }
}
