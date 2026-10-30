import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type AudioChannel,
  type TranscriptSegment,
  type TranscriptionStatus
} from '../../shared/types.js'
import { IPC } from '../../shared/ipc-channels.js'

interface FakeChannel {
  provider: string
  opts: {
    channel: AudioChannel
    onSegment: (seg: TranscriptSegment) => void
    onStatus: (status: TranscriptionStatus) => void
    [key: string]: unknown
  }
  sent: ArrayBuffer[]
  closed: boolean
}

const h = vi.hoisted(() => {
  const made: FakeChannel[] = []
  function channelClass(provider: string) {
    return class {
      readonly provider = provider
      readonly sent: ArrayBuffer[] = []
      closed = false
      constructor(readonly opts: FakeChannel['opts']) {
        made.push(this)
      }
      send(buffer: ArrayBuffer): void {
        this.sent.push(buffer)
      }
      close(): void {
        this.closed = true
      }
    }
  }
  return {
    made,
    channelClass,
    settings: {} as AppSettings,
    ragPushed: [] as Array<{ sessionId: string; text: string }>,
    ragFlushed: [] as string[]
  }
})

vi.mock('../settings.js', () => ({ getSettings: () => h.settings }))
vi.mock('../rag/index.js', () => ({
  pushSegment: (sessionId: string, seg: TranscriptSegment) => {
    h.ragPushed.push({ sessionId, text: seg.text })
  },
  flushSession: async (sessionId: string) => {
    h.ragFlushed.push(sessionId)
  }
}))
vi.mock('./deepgramSttClient.js', () => ({ DeepgramSttChannel: h.channelClass('deepgram') }))
vi.mock('./elevenlabsSttClient.js', () => ({ ElevenLabsSttChannel: h.channelClass('elevenlabs') }))
vi.mock('./openaiWhisperClient.js', () => ({
  OpenAiWhisperSttChannel: h.channelClass('openai-whisper')
}))
vi.mock('./googleSttClient.js', () => ({ GoogleSttChannel: h.channelClass('google') }))
vi.mock('./localWhisperClient.js', () => ({
  LocalWhisperSttChannel: h.channelClass('local-whisper')
}))
vi.mock('./localParakeetClient.js', () => ({
  LocalParakeetSttChannel: h.channelClass('local-parakeet')
}))

const { SessionManager } = await import('./sessionManager.js')
const { recordExchange, exchangeCount } = await import('../ai/exchangeMemory.js')

function configure(patch: Partial<AppSettings> = {}, systemEnabled = false): void {
  h.settings = {
    ...DEFAULT_SETTINGS,
    sttProvider: 'deepgram',
    deepgramApiKey: 'dg-key',
    elevenlabsApiKey: 'el-key',
    openaiApiKey: 'oa-key',
    googleProjectId: 'gcp-project',
    googleServiceAccountJson: '{"client_email":"bot@gcp"}',
    transcriptionLanguage: 'ru',
    audio: { ...DEFAULT_SETTINGS.audio, systemEnabled },
    ...patch
  }
}

function fakeWindow(init: { visible?: boolean; minimized?: boolean } = {}) {
  const listeners: Record<string, Array<() => void>> = {}
  const win = {
    sent: [] as Array<{ channel: string; payload: unknown }>,
    visible: init.visible ?? true,
    minimized: init.minimized ?? false,
    destroyed: false,
    webContents: {
      send: (channel: string, payload: unknown): void => {
        win.sent.push({ channel, payload })
      }
    },
    on: (event: string, cb: () => void): void => {
      ;(listeners[event] ??= []).push(cb)
    },
    emit: (event: 'show' | 'restore' | 'closed'): void => {
      for (const cb of listeners[event] ?? []) cb()
    },
    isDestroyed: (): boolean => win.destroyed,
    isVisible: (): boolean => win.visible,
    isMinimized: (): boolean => win.minimized
  }
  return win
}
type FakeWin = ReturnType<typeof fakeWindow>

function newManager(...windows: FakeWin[]) {
  const mgr = new SessionManager()
  const wins = windows.length > 0 ? windows : [fakeWindow()]
  for (const w of wins) mgr.registerWindow(w as unknown as BrowserWindow)
  return { mgr, win: wins[0]! }
}

function seg(text: string, over: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: text,
    channel: 'mic',
    speaker: 0,
    startMs: 0,
    endMs: 0,
    text,
    isFinal: true,
    createdAt: 0,
    ...over
  }
}

function segmentTexts(win: FakeWin): string[] {
  return win.sent
    .filter((m) => m.channel === IPC.transcription.segment)
    .map((m) => (m.payload as TranscriptSegment).text)
}

function channelFor(channel: AudioChannel): FakeChannel {
  const found = h.made.find((c) => c.opts.channel === channel)
  if (!found) throw new Error(`no ${channel} channel was opened`)
  return found
}

function chunk(...samples: number[]): ArrayBuffer {
  return new Int16Array(samples).buffer
}

beforeEach(() => {
  h.made.length = 0
  h.ragPushed.length = 0
  h.ragFlushed.length = 0
  configure()
})

describe('SessionManager start', () => {
  it.each([
    ['google', { googleProjectId: null }, /Google Cloud project ID/],
    ['deepgram', { deepgramApiKey: '' }, /Deepgram API key/],
    ['elevenlabs', { elevenlabsApiKey: null }, /ElevenLabs API key/],
    ['openai-whisper', { openaiApiKey: null }, /OpenAI API key/]
  ] as const)(
    'refuses to start %s without its credentials and stays idle',
    async (sttProvider, missing, message) => {
      configure({ sttProvider, ...missing })
      const { mgr, win } = newManager()
      const states: string[] = []
      mgr.onState((s) => states.push(s.kind))

      await expect(mgr.start()).rejects.toThrow(message)

      expect(mgr.getState()).toEqual({ kind: 'idle' })
      expect(states).toEqual(['starting', 'idle'])
      expect(h.made).toHaveLength(0)
      const lastBroadcast = win.sent.filter((m) => m.channel === IPC.session.state).at(-1)
      expect(lastBroadcast?.payload).toEqual({ kind: 'idle' })
    }
  )

  it('lets the on-device provider start with no credentials at all', async () => {
    configure({ sttProvider: 'local-whisper', transcriptionLanguage: 'en' })
    const { mgr } = newManager()
    const { sessionId } = await mgr.start()
    expect(mgr.getState()).toMatchObject({ kind: 'running', sessionId })
    expect(h.made).toHaveLength(1)
  })

  it.each([
    [
      'deepgram',
      { sttProvider: 'deepgram', transcriptionLanguage: 'ru' },
      'deepgram',
      { apiKey: 'dg-key', language: 'ru' }
    ],
    [
      'elevenlabs',
      { sttProvider: 'elevenlabs', transcriptionLanguage: 'multi' },
      'elevenlabs',
      { apiKey: 'el-key', language: 'multi' }
    ],
    [
      'openai-whisper',
      { sttProvider: 'openai-whisper', transcriptionLanguage: 'de' },
      'openai-whisper',
      { apiKey: 'oa-key', language: 'de' }
    ],
    [
      'google',
      { sttProvider: 'google', transcriptionLanguage: 'fr' },
      'google',
      { projectId: 'gcp-project', serviceAccountJson: '{"client_email":"bot@gcp"}', language: 'fr' }
    ],
    [
      'local with a language Parakeet covers',
      { sttProvider: 'local-whisper', transcriptionLanguage: 'ru' },
      'local-parakeet',
      {}
    ],
    [
      'local with a language only Whisper covers',
      { sttProvider: 'local-whisper', transcriptionLanguage: 'ja' },
      'local-whisper',
      { language: 'ja' }
    ]
  ] as const)(
    'opens the %s channel with its own credentials and language',
    async (_label, patch, provider, expected) => {
      configure(patch)
      const { mgr } = newManager()
      await mgr.start()
      expect(h.made).toHaveLength(1)
      expect(h.made[0]!.provider).toBe(provider)
      expect(h.made[0]!.opts).toMatchObject({ channel: 'mic', ...expected })
    }
  )

  it('opens a mic channel, plus a system channel only when system audio is on', async () => {
    configure({}, false)
    await newManager().mgr.start()
    expect(h.made.map((c) => c.opts.channel)).toEqual(['mic'])

    h.made.length = 0
    configure({}, true)
    await newManager().mgr.start()
    expect(h.made.map((c) => c.opts.channel)).toEqual(['mic', 'system'])
    expect(new Set(h.made.map((c) => c.provider)).size).toBe(1)
  })

  it('shows an error on screen when the provider id is unknown instead of staying silent', async () => {
    configure({ sttProvider: 'whisper-9000' as never })
    const { mgr, win } = newManager()
    await mgr.start()

    const statuses = win.sent
      .filter((m) => m.channel === IPC.transcription.status)
      .map((m) => m.payload as TranscriptionStatus)
    expect(statuses).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        channel: 'mic',
        message: expect.stringContaining('whisper-9000')
      })
    )
  })

  it('returns the live session instead of opening a second set of channels', async () => {
    configure({}, true)
    const { mgr } = newManager()
    const [a, b] = await Promise.all([mgr.start(), mgr.start()])
    expect(b.sessionId).toBe(a.sessionId)
    expect(h.made).toHaveLength(2)
  })

  it('resumes under the given id and forgets the previous call’s Q&A', async () => {
    recordExchange('Who are you?', 'A backend developer.')
    expect(exchangeCount()).toBe(1)
    const { mgr } = newManager()

    const { sessionId } = await mgr.start({ resumeId: 'resume-me' })

    expect(sessionId).toBe('resume-me')
    expect(mgr.getState()).toMatchObject({ kind: 'running', sessionId: 'resume-me' })
    expect(exchangeCount()).toBe(0)
  })

  it('gives every fresh session its own id', async () => {
    const { mgr } = newManager()
    const first = await mgr.start()
    await mgr.stop()
    const second = await mgr.start()
    expect(second.sessionId).not.toBe(first.sessionId)
  })

  it('keeps the running session on its provider when settings change, and uses the new one next time', async () => {
    configure({ sttProvider: 'deepgram' })
    const { mgr } = newManager()
    await mgr.start()
    configure({ sttProvider: 'elevenlabs' })

    mgr.sendAudio('mic', chunk(1, 2))
    expect(h.made).toHaveLength(1)
    expect(h.made[0]!.provider).toBe('deepgram')
    expect(h.made[0]!.sent).toHaveLength(1)

    await mgr.stop()
    await mgr.start()
    expect(h.made.map((c) => c.provider)).toEqual(['deepgram', 'elevenlabs'])
  })
})

describe('SessionManager audio routing', () => {
  it('sends each chunk only to the channel it was captured on', async () => {
    configure({}, true)
    const { mgr } = newManager()
    await mgr.start()

    mgr.sendAudio('mic', chunk(1))
    mgr.sendAudio('system', chunk(2))
    mgr.sendAudio('system', chunk(3))

    expect(channelFor('mic').sent.map((b) => Array.from(new Int16Array(b)))).toEqual([[1]])
    expect(channelFor('system').sent.map((b) => Array.from(new Int16Array(b)))).toEqual([[2], [3]])
  })

  it('drops system audio when system capture is off and audio arriving after Stop', async () => {
    configure({}, false)
    const { mgr } = newManager()
    await mgr.start()
    mgr.sendAudio('system', chunk(9))
    await mgr.stop()
    mgr.sendAudio('mic', chunk(8))

    expect(h.made).toHaveLength(1)
    expect(channelFor('mic').sent).toEqual([])
  })

  it('does not throw when audio arrives before any session exists', () => {
    const { mgr } = newManager()
    expect(() => mgr.sendAudio('mic', chunk(1))).not.toThrow()
  })
})

describe('SessionManager stop', () => {
  it('closes every channel, indexes the tail for that session and announces the end once', async () => {
    configure({}, true)
    const { mgr } = newManager()
    const ended: string[] = []
    mgr.onSessionEnd((id) => ended.push(id))
    const { sessionId } = await mgr.start()

    await mgr.stop()
    await mgr.stop()

    expect(h.made.every((c) => c.closed)).toBe(true)
    expect(h.ragFlushed).toEqual([sessionId])
    expect(ended).toEqual([sessionId])
    expect(mgr.getState()).toEqual({ kind: 'idle' })
  })

  it('does nothing when no session is running', async () => {
    const { mgr, win } = newManager()
    const ended = vi.fn()
    mgr.onSessionEnd(ended)

    await mgr.stop()

    expect(ended).not.toHaveBeenCalled()
    expect(h.ragFlushed).toEqual([])
    expect(win.sent).toEqual([])
  })

  it('walks windows and in-process listeners through starting, running, stopping, idle', async () => {
    const { mgr, win } = newManager()
    const seen: string[] = []
    mgr.onState((s) => seen.push(s.kind))

    await mgr.start()
    await mgr.stop()

    const expected = ['starting', 'running', 'stopping', 'idle']
    expect(seen).toEqual(expected)
    const broadcast = win.sent
      .filter((m) => m.channel === IPC.session.state)
      .map((m) => (m.payload as { kind: string }).kind)
    expect(broadcast).toEqual(expected)
  })

  it('ends idle with every channel closed when Stop races a Start', async () => {
    configure({}, true)
    const { mgr } = newManager()
    const ended: string[] = []
    mgr.onSessionEnd((id) => ended.push(id))

    const [started] = await Promise.all([mgr.start(), mgr.stop()])

    expect(mgr.getState()).toEqual({ kind: 'idle' })
    expect(h.made.every((c) => c.closed)).toBe(true)
    expect(ended).toEqual([started.sessionId])
  })

  it('can start a new call right after stopping one without leaking the old channels', async () => {
    configure({}, true)
    const { mgr } = newManager()
    await mgr.start()
    await mgr.stop()
    const second = await mgr.start()

    expect(h.made).toHaveLength(4)
    expect(h.made.slice(0, 2).every((c) => c.closed)).toBe(true)
    expect(h.made.slice(2).every((c) => !c.closed)).toBe(true)
    expect(mgr.getState()).toMatchObject({ kind: 'running', sessionId: second.sessionId })
  })
})

describe('SessionManager transcript delivery', () => {
  it('shows a live final in every window, hidden ones included, and tells the listeners which session it belongs to', async () => {
    const visible = fakeWindow()
    const hidden = fakeWindow({ visible: false })
    const { mgr } = newManager(visible, hidden)
    const heard: Array<{ text: string; sessionId: string }> = []
    mgr.onSegment((s, sessionId) => heard.push({ text: s.text, sessionId }))
    const { sessionId } = await mgr.start()

    channelFor('mic').opts.onSegment(seg('Расскажите о своём опыте 🚀'))

    expect(segmentTexts(visible)).toEqual(['Расскажите о своём опыте 🚀'])
    expect(segmentTexts(hidden)).toEqual(['Расскажите о своём опыте 🚀'])
    expect(heard).toEqual([{ text: 'Расскажите о своём опыте 🚀', sessionId }])
    expect(h.ragPushed).toEqual([{ sessionId, text: 'Расскажите о своём опыте 🚀' }])
  })

  it('keeps interims out of hidden and minimized windows and catches them up with the latest one on show or restore', async () => {
    const visible = fakeWindow()
    const hidden = fakeWindow({ visible: false })
    const minimized = fakeWindow({ minimized: true })
    const { mgr } = newManager(visible, hidden, minimized)
    await mgr.start()
    const mic = channelFor('mic').opts

    mic.onSegment(seg('so what', { isFinal: false }))
    mic.onSegment(seg('so what did you', { isFinal: false }))
    mic.onSegment(seg('so what did you build', { isFinal: false }))

    expect(segmentTexts(visible)).toEqual(['so what', 'so what did you', 'so what did you build'])
    expect(segmentTexts(hidden)).toEqual([])
    expect(segmentTexts(minimized)).toEqual([])

    hidden.visible = true
    hidden.emit('show')
    minimized.minimized = false
    minimized.emit('restore')
    expect(segmentTexts(hidden)).toEqual(['so what did you build'])
    expect(segmentTexts(minimized)).toEqual(['so what did you build'])
  })

  it('catches a window up per channel, one latest interim for the mic and one for the system', async () => {
    configure({}, true)
    const hidden = fakeWindow({ visible: false })
    const { mgr } = newManager(hidden)
    await mgr.start()

    channelFor('mic').opts.onSegment(seg('my words', { isFinal: false }))
    channelFor('system').opts.onSegment(seg('their words', { isFinal: false, channel: 'system' }))
    channelFor('system').opts.onSegment(
      seg('their words continue', { isFinal: false, channel: 'system' })
    )
    hidden.visible = true
    hidden.emit('show')

    expect(segmentTexts(hidden).sort()).toEqual(['my words', 'their words continue'])
  })

  it('does not replay an interim once its sentence was finalized', async () => {
    const hidden = fakeWindow({ visible: false })
    const { mgr } = newManager(hidden)
    await mgr.start()
    const mic = channelFor('mic').opts

    mic.onSegment(seg('tell me about', { isFinal: false }))
    mic.onSegment(seg('Tell me about yourself.'))
    hidden.visible = true
    hidden.emit('show')

    expect(segmentTexts(hidden)).toEqual(['Tell me about yourself.'])
  })

  it('does not replay an interim after the call stopped', async () => {
    const hidden = fakeWindow({ visible: false })
    const { mgr } = newManager(hidden)
    await mgr.start()

    const mic = channelFor('mic').opts

    mic.onSegment(seg('and then', { isFinal: false }))
    await mgr.stop()
    mic.onSegment(seg('late interim', { isFinal: false }))
    hidden.visible = true
    hidden.emit('show')

    expect(segmentTexts(hidden)).toEqual([])
  })

  it('still delivers a final that lands after Stop under the stopped session, but does not index it', async () => {
    const { mgr, win } = newManager()
    const heard: Array<{ text: string; sessionId: string }> = []
    mgr.onSegment((s, sessionId) => heard.push({ text: s.text, sessionId }))
    const { sessionId } = await mgr.start()
    const mic = channelFor('mic').opts

    await mgr.stop()
    mic.onSegment(seg('last words'))

    expect(heard).toEqual([{ text: 'last words', sessionId }])
    expect(segmentTexts(win)).toEqual(['last words'])
    expect(h.ragPushed).toEqual([])
  })

  it('keeps a straggler from the previous call out of the next call’s live transcript and files it under the old id', async () => {
    const { mgr, win } = newManager()
    const heard: Array<{ text: string; sessionId: string }> = []
    mgr.onSegment((s, sessionId) => heard.push({ text: s.text, sessionId }))
    const first = await mgr.start()
    const oldMic = channelFor('mic').opts
    await mgr.stop()
    const second = await mgr.start()

    oldMic.onSegment(seg('old call tail'))
    oldMic.onSegment(seg('old interim', { isFinal: false }))
    h.made[1]!.opts.onSegment(seg('new call'))

    expect(segmentTexts(win)).toEqual(['new call'])
    expect(heard).toEqual([
      { text: 'old call tail', sessionId: first.sessionId },
      { text: 'old interim', sessionId: first.sessionId },
      { text: 'new call', sessionId: second.sessionId }
    ])
    expect(h.ragPushed).toEqual([{ sessionId: second.sessionId, text: 'new call' }])
  })

  it('stops sending to a window once it is closed or destroyed', async () => {
    const closing = fakeWindow()
    const dying = fakeWindow()
    const healthy = fakeWindow()
    const { mgr } = newManager(closing, dying, healthy)
    await mgr.start()
    const mic = channelFor('mic').opts

    closing.emit('closed')
    dying.destroyed = true
    mic.onSegment(seg('after close'))

    const stateMessages = (w: FakeWin): number =>
      w.sent.filter((m) => m.channel === IPC.transcription.segment).length
    expect(stateMessages(closing)).toBe(0)
    expect(stateMessages(dying)).toBe(0)
    expect(stateMessages(healthy)).toBe(1)
  })

  it('forwards channel status to every window so a dropped connection is visible', async () => {
    const a = fakeWindow()
    const b = fakeWindow({ visible: false })
    const { mgr } = newManager(a, b)
    await mgr.start()

    channelFor('mic').opts.onStatus({ kind: 'error', channel: 'mic', message: 'socket hang up' })

    for (const w of [a, b]) {
      expect(w.sent).toContainEqual({
        channel: IPC.transcription.status,
        payload: { kind: 'error', channel: 'mic', message: 'socket hang up' }
      })
    }
  })

  it('stops delivering to a listener once it unsubscribes', async () => {
    const { mgr } = newManager()
    const heard: string[] = []
    const off = mgr.onSegment((s) => heard.push(s.text))
    await mgr.start()
    const mic = channelFor('mic').opts

    mic.onSegment(seg('one'))
    off()
    mic.onSegment(seg('two'))

    expect(heard).toEqual(['one'])
  })
})
