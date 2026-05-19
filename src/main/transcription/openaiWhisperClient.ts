import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import { pcm16ToBase64, resamplePcm16 } from './pcmUtils.js'

export interface OpenAiWhisperOptions {
  apiKey: string
  channel: AudioChannel
  language: string
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

const CAPTURE_RATE = 16_000
// OpenAI's realtime `pcm16` format requires 24 kHz mono input.
const TARGET_RATE = 24_000
const MODEL = 'gpt-4o-transcribe'
const ENDPOINT = 'wss://api.openai.com/v1/realtime?intent=transcription'
const MAX_RETRIES = 10

interface OpenAiEvent {
  type: string
  item_id?: string
  delta?: string
  transcript?: string
  error?: { message?: string }
}

/**
 * OpenAI realtime transcription STT — streams audio over a WebSocket to the
 * Realtime API (`gpt-4o-transcribe`) with server-side VAD. Interim text comes
 * from `...transcription.delta` events; finals from `...transcription.completed`.
 * Connect/reconnect lifecycle mirrors the Deepgram client.
 */
export class OpenAiWhisperSttChannel {
  private ws: WebSocket | null = null
  private closed = false
  private ready = false
  private retries = 0
  private retryTimer: NodeJS.Timeout | null = null
  private reconnectScheduled = false
  // Audio that arrived before the socket opened — replayed on open.
  private pending: Int16Array[] = []
  // Monotonic count of audio milliseconds streamed, used to stamp segments.
  private offsetMs = 0
  private committedMs = 0
  // Partial transcript text accumulated per in-flight transcription item.
  private partials = new Map<string, string>()

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
    this.connect()
  }

  send(buffer: ArrayBuffer): void {
    if (this.closed) return
    const samples = new Int16Array(buffer)
    this.offsetMs += Math.round((samples.length / CAPTURE_RATE) * 1000)
    if (this.ws && this.ready) {
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
    this.reconnectScheduled = false
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.pending = []
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
  }

  private pushAudio(samples: Int16Array): void {
    const upsampled = resamplePcm16(samples, CAPTURE_RATE, TARGET_RATE)
    try {
      this.ws?.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcm16ToBase64(upsampled)
        })
      )
    } catch (err) {
      console.warn(`[openai-whisper:${this.opts.channel}] send failed`, err)
    }
  }

  private connect(): void {
    if (this.closed) return
    this.opts.onStatus({ kind: 'connecting', channel: this.opts.channel })

    const ws = new WebSocket(ENDPOINT, {
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    })
    this.ws = ws

    ws.on('open', () => {
      if (this.closed) {
        ws.close()
        return
      }
      this.ready = true
      this.retries = 0
      console.log(`[openai-whisper:${this.opts.channel}] open (model=${MODEL})`)
      const language = this.opts.language
      ws.send(
        JSON.stringify({
          type: 'transcription_session.update',
          session: {
            input_audio_format: 'pcm16',
            input_audio_transcription: {
              model: MODEL,
              ...(language && language !== 'multi' ? { language } : {})
            },
            turn_detection: { type: 'server_vad' }
          }
        })
      )
      this.opts.onStatus({ kind: 'open', channel: this.opts.channel })
      for (const samples of this.pending) this.pushAudio(samples)
      this.pending = []
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let event: OpenAiEvent
      try {
        event = JSON.parse(raw.toString()) as OpenAiEvent
      } catch {
        return
      }
      this.handleEvent(event)
    })

    ws.on('error', (err: Error) => {
      console.error(`[openai-whisper:${this.opts.channel}] error`, err.message)
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: err.message
      })
      this.ready = false
      if (!this.closed) this.scheduleReconnect()
    })

    ws.on('close', () => {
      console.log(`[openai-whisper:${this.opts.channel}] closed`)
      this.ready = false
      if (!this.closed) this.scheduleReconnect()
    })
  }

  private handleEvent(event: OpenAiEvent): void {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.delta': {
        const itemId = event.item_id ?? 'default'
        const acc = (this.partials.get(itemId) ?? '') + (event.delta ?? '')
        this.partials.set(itemId, acc)
        this.emit(acc, false)
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const itemId = event.item_id ?? 'default'
        this.partials.delete(itemId)
        this.emit(event.transcript ?? '', true)
        this.committedMs = this.offsetMs
        break
      }
      case 'conversation.item.input_audio_transcription.failed':
      case 'error': {
        const message = event.error?.message ?? 'transcription error'
        console.warn(`[openai-whisper:${this.opts.channel}] ${event.type}`, message)
        this.opts.onStatus({ kind: 'error', channel: this.opts.channel, message })
        break
      }
      default:
        break
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
      this.connect()
    }, delay)
  }
}
