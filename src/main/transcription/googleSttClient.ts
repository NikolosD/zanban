import { v2 } from '@google-cloud/speech'
import { randomUUID } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'

export interface GoogleSttChannelOptions {
  /**
   * Google Cloud project ID. Used to construct the v2 recognizer path
   * `projects/{id}/locations/global/recognizers/_`. Required.
   */
  projectId: string
  /**
   * Optional service-account JSON (raw string). When omitted, we let the SDK
   * pick up Application Default Credentials — i.e. whatever
   * `gcloud auth application-default login` saved in the user's profile.
   */
  serviceAccountJson: string | null
  language: string
  channel: AudioChannel
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

interface ServiceAccount {
  client_email?: string
  private_key?: string
  project_id?: string
}

// Chirp 3 streamingRecognize allows at most 3 language codes per request.
// `["auto"]` enables language-agnostic transcription — chirp_3's documented
// path for multilingual streams. Explicit code lists are only used when the
// user pins a specific language.
const LANGUAGE_CODES: Record<string, string[]> = {
  multi: ['auto'],
  en: ['en-US'],
  ru: ['ru-RU', 'en-US'],
  es: ['es-ES', 'en-US'],
  de: ['de-DE', 'en-US'],
  fr: ['fr-FR', 'en-US'],
  it: ['it-IT', 'en-US'],
  pt: ['pt-BR', 'en-US'],
  ja: ['ja-JP', 'en-US'],
  ko: ['ko-KR', 'en-US'],
  zh: ['cmn-Hans-CN', 'en-US']
}

function resolveLanguageCodes(lang: string): string[] {
  // Hard cap of 3: chirp_3 streamingRecognize rejects requests with more.
  return (LANGUAGE_CODES[lang] ?? LANGUAGE_CODES.multi!).slice(0, 3)
}

// Chirp 3 is the only Chirp variant that supports multilingual streaming
// (multiple languageCodes in one request). It's served from EU and US
// multi-region zones — we pin to `eu`. Both the recognizer path AND the
// client's apiEndpoint must agree on the location, or the SDK silently
// routes to global and the request is rejected.
const STT_LOCATION = 'eu'
const STT_MODEL = 'chirp_3'

interface RecognizeResult {
  isFinal?: boolean | null
  resultEndOffset?: { seconds?: number | string | null; nanos?: number | null } | null
  alternatives?: Array<{ transcript?: string | null }> | null
}

export class GoogleSttChannel {
  private client: v2.SpeechClient | null = null
  private stream: Duplex | null = null
  private opts: GoogleSttChannelOptions
  private closed = false
  private ready = false
  private retries = 0
  private retryTimer: NodeJS.Timeout | null = null
  private reconnectScheduled = false
  private droppedCount = 0
  private sentCount = 0

  constructor(opts: GoogleSttChannelOptions) {
    this.opts = opts
    void this.connect()
  }

  send(buffer: ArrayBuffer): void {
    const stream = this.stream
    if (stream && this.ready && !this.closed) {
      try {
        stream.write({ audio: Buffer.from(buffer) })
        this.sentCount += 1
        if (this.sentCount === 1 || this.sentCount % 50 === 0) {
          console.log(
            `[google-stt:${this.opts.channel}] sent chunk #${this.sentCount} (dropped=${this.droppedCount} before open)`
          )
        }
      } catch (err) {
        console.warn(`[google-stt:${this.opts.channel}] send failed`, err)
      }
    } else {
      this.droppedCount += 1
      if (this.droppedCount === 1) {
        console.warn(
          `[google-stt:${this.opts.channel}] dropping chunk — stream=${!!stream} ready=${this.ready}`
        )
      }
    }
  }

  close(): void {
    this.closed = true
    this.ready = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.reconnectScheduled = false
    try {
      this.stream?.end()
    } catch {
      /* ignore */
    }
    this.stream = null
    this.client = null
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    if (!this.opts.projectId) {
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: 'Google project ID required'
      })
      return
    }

    let clientOpts: ConstructorParameters<typeof v2.SpeechClient>[0] = {
      projectId: this.opts.projectId,
      apiEndpoint: `${STT_LOCATION}-speech.googleapis.com`
    }

    if (this.opts.serviceAccountJson?.trim()) {
      let creds: ServiceAccount
      try {
        creds = JSON.parse(this.opts.serviceAccountJson) as ServiceAccount
      } catch {
        this.opts.onStatus({
          kind: 'error',
          channel: this.opts.channel,
          message: 'Service account JSON is malformed'
        })
        return
      }
      if (!creds.client_email || !creds.private_key) {
        this.opts.onStatus({
          kind: 'error',
          channel: this.opts.channel,
          message: 'Service account JSON missing client_email / private_key'
        })
        return
      }
      clientOpts = {
        ...clientOpts,
        credentials: {
          client_email: creds.client_email,
          private_key: creds.private_key
        }
      }
    }

    this.opts.onStatus({ kind: 'connecting', channel: this.opts.channel })

    try {
      this.client = new v2.SpeechClient(clientOpts)

      const languageCodes = resolveLanguageCodes(this.opts.language)
      const recognizer = `projects/${this.opts.projectId}/locations/${STT_LOCATION}/recognizers/_`

      // The gapic client exposes the bidi stream as `_streamingRecognize`.
      const stream = (
        this.client as unknown as { _streamingRecognize(): Duplex }
      )._streamingRecognize()
      this.stream = stream

      stream.on('error', (err: Error) => {
        const details = err as unknown as {
          details?: unknown
          statusDetails?: unknown
          metadata?: { internalRepr?: Map<string, unknown> }
        }
        const meta = details.metadata?.internalRepr
          ? Object.fromEntries(details.metadata.internalRepr)
          : undefined
        console.error(
          `[google-stt:${this.opts.channel}] error`,
          err.message,
          JSON.stringify({
            details: details.details,
            statusDetails: details.statusDetails,
            metadata: meta
          })
        )
        // Google STT enforces a ~5-minute streaming limit and aborts with
        // "Stream timed out after receiving no more client requests" — that's
        // expected, not a user-facing failure. Same for typical transient
        // network blips that scheduleReconnect handles automatically. We
        // downgrade these to `closed` so the overlay's transcription-error
        // banner doesn't flash every five minutes; the next `open` event
        // restores the running state. Real failures (auth, project mis-config,
        // exhausted retries) still surface through `kind: 'error'` from the
        // other code paths in this client.
        const isTransient =
          /Stream timed out/i.test(err.message) ||
          /ABORTED/i.test(err.message) ||
          /UNAVAILABLE/i.test(err.message) ||
          /CANCELLED/i.test(err.message)
        if (isTransient && !this.closed) {
          this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
        } else {
          this.opts.onStatus({
            kind: 'error',
            channel: this.opts.channel,
            message: err.message
          })
        }
        this.ready = false
        if (!this.closed) this.scheduleReconnect()
      })

      stream.on('end', () => {
        console.log(`[google-stt:${this.opts.channel}] stream ended`)
        this.ready = false
        this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
        if (!this.closed) this.scheduleReconnect()
      })

      stream.on('data', (response: { results?: RecognizeResult[] | null }) => {
        // Only reset the retry counter once we actually receive data — if the
        // config request itself is rejected, the connection opens then errors,
        // and resetting on `open` would mask a bad config as an infinite loop.
        if (this.retries !== 0) this.retries = 0
        for (const result of response.results ?? []) {
          const alt = result.alternatives?.[0]
          const text = alt?.transcript?.trim()
          if (!text) continue
          const isFinal = !!result.isFinal
          const endSec = Number(result.resultEndOffset?.seconds ?? 0)
          const endNanos = Number(result.resultEndOffset?.nanos ?? 0)
          const endMs = Math.round(endSec * 1000 + endNanos / 1_000_000)
          console.log(`[google-stt:${this.opts.channel}] final=${isFinal} text="${text}"`)
          this.opts.onSegment({
            id: randomUUID(),
            channel: this.opts.channel,
            speaker: 0,
            startMs: endMs,
            endMs,
            text,
            isFinal,
            createdAt: Date.now()
          })
        }
      })

      // First message — recognizer + streaming config. Chirp 2 supports
      // multilingual streaming including code-switching across the language
      // codes we pass.
      stream.write({
        recognizer,
        streamingConfig: {
          config: {
            explicitDecodingConfig: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              audioChannelCount: 1
            },
            languageCodes,
            model: STT_MODEL,
            features: {
              enableAutomaticPunctuation: true
            }
          },
          streamingFeatures: {
            interimResults: true
          }
        }
      })

      this.ready = true
      const authMode = this.opts.serviceAccountJson?.trim() ? 'service-account' : 'ADC'
      console.log(
        `[google-stt:${this.opts.channel}] stream open (auth=${authMode}, location=${STT_LOCATION}, languageCodes=${languageCodes.join(',')}, model=${STT_MODEL})`
      )
      this.opts.onStatus({ kind: 'open', channel: this.opts.channel })
    } catch (err) {
      console.error(`[google-stt:${this.opts.channel}] connect failed`, err)
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
    if (this.retries > 5) {
      this.opts.onStatus({
        kind: 'error',
        channel: this.opts.channel,
        message: 'reconnect attempts exhausted'
      })
      return
    }
    const delay = Math.min(15_000, 500 * 2 ** this.retries)
    this.retryTimer = setTimeout(() => {
      this.reconnectScheduled = false
      void this.connect()
    }, delay)
  }
}
