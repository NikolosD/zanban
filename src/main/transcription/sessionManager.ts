import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type {
  AudioChannel,
  SessionState,
  TranscriptSegment,
  TranscriptionStatus
} from '../../shared/types.js'
import { GoogleSttChannel } from './googleSttClient.js'
import { DeepgramSttChannel } from './deepgramSttClient.js'
import { LocalWhisperSttChannel } from './localWhisperClient.js'
import { ElevenLabsSttChannel } from './elevenlabsSttClient.js'
import { OpenAiWhisperSttChannel } from './openaiWhisperClient.js'
import { StubSttChannel } from './stubSttClient.js'
import { getSettings } from '../settings.js'
import { IPC } from '../../shared/ipc-channels.js'
import { clearExchanges } from '../ai/exchangeMemory.js'
import { pushSegment as ragPush, flushSession as ragFlush } from '../rag/index.js'

// Common shape every STT backend exposes — lets us swap providers without
// teaching sessionManager about each one's quirks.
interface SttChannel {
  send(buffer: ArrayBuffer): void
  close(): void
}

type Sender = (channel: string, payload: unknown) => void

export class SessionManager {
  private state: SessionState = { kind: 'idle' }
  private channels = new Map<AudioChannel, SttChannel>()
  private windows: BrowserWindow[] = []
  private segmentListeners = new Set<(seg: TranscriptSegment) => void>()

  registerWindow(win: BrowserWindow): void {
    this.windows.push(win)
    win.on('closed', () => {
      this.windows = this.windows.filter((w) => w !== win)
    })
  }

  onSegment(cb: (seg: TranscriptSegment) => void): () => void {
    this.segmentListeners.add(cb)
    return () => this.segmentListeners.delete(cb)
  }

  getState(): SessionState {
    return this.state
  }

  async start(opts?: { resumeId?: string }): Promise<{ sessionId: string }> {
    if (this.state.kind === 'running') return { sessionId: this.state.sessionId }
    this.setState({ kind: 'starting' })
    const settings = getSettings()
    // Validate provider-specific credentials up front so the user gets a
    // pointed error instead of a silent connect failure deep inside the
    // STT client.
    if (settings.sttProvider === 'google') {
      if (!settings.googleProjectId) {
        this.setState({ kind: 'idle' })
        throw new Error('Google Cloud project ID not set. Open Settings.')
      }
    } else if (settings.sttProvider === 'deepgram') {
      if (!settings.deepgramApiKey) {
        this.setState({ kind: 'idle' })
        throw new Error('Deepgram API key not set. Open Settings.')
      }
    } else if (settings.sttProvider === 'elevenlabs') {
      if (!settings.elevenlabsApiKey) {
        this.setState({ kind: 'idle' })
        throw new Error('ElevenLabs API key not set. Open Settings → Providers.')
      }
    } else if (settings.sttProvider === 'openai-whisper') {
      if (!settings.openaiApiKey) {
        this.setState({ kind: 'idle' })
        throw new Error('OpenAI API key not set. Open Settings → Providers.')
      }
    }
    // local-whisper has no key requirement; it just needs to load Xenova
    // weights on first use. Validation happens inside the channel.
    // Fresh session — drop any Q&A memory from previous calls. We always
    // clear, even on resume: the in-memory exchange buffer is just used for
    // recent-context priming, and stale entries from a different call would
    // confuse the next prompt.
    clearExchanges()
    this.openChannel('mic')
    if (settings.audio.systemEnabled) {
      this.openChannel('system')
    }
    const sessionId = opts?.resumeId ?? randomUUID()
    this.setState({ kind: 'running', sessionId, startedAt: Date.now() })
    return { sessionId }
  }

  async stop(): Promise<void> {
    if (this.state.kind === 'idle') return
    const finishedSessionId =
      this.state.kind === 'running' ? this.state.sessionId : null
    this.setState({ kind: 'stopping' })
    for (const ch of this.channels.values()) ch.close()
    this.channels.clear()
    if (finishedSessionId) {
      // Index whatever final segments still sit in the live indexer buffer so
      // RAG sees the tail of the session (the periodic flush only fires on
      // size or time thresholds, both of which rarely line up with the user
      // hitting Stop).
      void ragFlush(finishedSessionId)
      for (const cb of this.endListeners) cb(finishedSessionId)
    }
    this.setState({ kind: 'idle' })
  }

  private endListeners = new Set<(sessionId: string) => void>()
  onSessionEnd(cb: (sessionId: string) => void): () => void {
    this.endListeners.add(cb)
    return () => this.endListeners.delete(cb)
  }

  sendAudio(channel: AudioChannel, buffer: ArrayBuffer): void {
    this.channels.get(channel)?.send(buffer)
  }

  private openChannel(channel: AudioChannel): void {
    const settings = getSettings()
    const onSegment = (seg: TranscriptSegment): void => {
      this.broadcast(IPC.transcription.segment, seg)
      for (const cb of this.segmentListeners) cb(seg)
      // Live RAG indexing: feed final segments into the per-session buffer.
      // Best-effort — failures swallowed inside the indexer.
      if (this.state.kind === 'running') ragPush(this.state.sessionId, seg)
    }
    const onStatus = (status: TranscriptionStatus): void => {
      this.broadcast(IPC.transcription.status, status)
    }

    let ch: SttChannel
    switch (settings.sttProvider) {
      case 'deepgram':
        ch = new DeepgramSttChannel({
          apiKey: settings.deepgramApiKey ?? '',
          language: settings.transcriptionLanguage,
          channel,
          onSegment,
          onStatus
        })
        break
      case 'google':
        ch = new GoogleSttChannel({
          projectId: settings.googleProjectId ?? '',
          serviceAccountJson: settings.googleServiceAccountJson,
          language: settings.transcriptionLanguage,
          channel,
          onSegment,
          onStatus
        })
        break
      case 'local-whisper':
        ch = new LocalWhisperSttChannel({
          language: settings.transcriptionLanguage,
          channel,
          onSegment,
          onStatus
        })
        break
      case 'elevenlabs':
        ch = new ElevenLabsSttChannel({
          apiKey: settings.elevenlabsApiKey ?? '',
          channel,
          language: settings.transcriptionLanguage,
          onSegment,
          onStatus
        })
        break
      case 'openai-whisper':
        ch = new OpenAiWhisperSttChannel({
          apiKey: settings.openaiApiKey ?? '',
          channel,
          language: settings.transcriptionLanguage,
          onSegment,
          onStatus
        })
        break
      default:
        ch = new StubSttChannel({
          channel,
          providerLabel: String(settings.sttProvider),
          onSegment,
          onStatus
        })
    }
    this.channels.set(channel, ch)
  }

  private broadcast(ipcChannel: string, payload: unknown): void {
    for (const w of this.windows) {
      if (!w.isDestroyed()) {
        ;(w.webContents.send as Sender)(ipcChannel, payload)
      }
    }
  }

  private setState(state: SessionState): void {
    this.state = state
    this.broadcast(IPC.session.state, state)
  }
}

export const sessionManager = new SessionManager()
