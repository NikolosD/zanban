import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { OpenAiWhisperOptions } from './openaiWhisperClient.js'

type Handler = (payload?: unknown) => void

const net = vi.hoisted(() => {
  class Socket {
    handlers = new Map<string, Handler>()
    sent: Array<Record<string, any>> = []
    terminated = false
    closed = false
    pings = 0
    constructor(
      readonly url: string,
      readonly opts: { headers: Record<string, string> }
    ) {
      sockets.push(this)
    }
    on(event: string, cb: Handler): void {
      this.handlers.set(event, cb)
    }
    send(data: string): void {
      this.sent.push(JSON.parse(data))
    }
    close(): void {
      this.closed = true
    }
    terminate(): void {
      this.terminated = true
    }
    ping(): void {
      this.pings += 1
    }
    emit(event: string, payload?: unknown): void {
      this.handlers.get(event)?.(payload)
    }
  }
  const sockets: Socket[] = []
  return { Socket, sockets }
})

vi.mock('ws', () => ({ default: net.Socket }))

const { OpenAiWhisperSttChannel } = await import('./openaiWhisperClient.js')

function make(over: Partial<OpenAiWhisperOptions> = {}) {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new OpenAiWhisperSttChannel({
    apiKey: 'oa-key',
    channel: 'mic',
    language: 'en',
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s),
    ...over
  })
  return { ch, segments, statuses }
}

function chunk(...samples: number[]): ArrayBuffer {
  return new Int16Array(samples).buffer
}

function lastSocket(): InstanceType<typeof net.Socket> {
  return net.sockets.at(-1)!
}

function say(sock: InstanceType<typeof net.Socket>, event: Record<string, unknown>): void {
  sock.emit('message', Buffer.from(JSON.stringify(event)))
}

function delta(itemId: string, text: string): Record<string, unknown> {
  return { type: 'conversation.item.input_audio_transcription.delta', item_id: itemId, delta: text }
}

function completed(itemId: string, transcript: string): Record<string, unknown> {
  return {
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: itemId,
    transcript
  }
}

function appended(sock: InstanceType<typeof net.Socket>): Int16Array[] {
  return sock.sent
    .filter((m) => m.type === 'input_audio_buffer.append')
    .map((m) => {
      const bytes = Buffer.from(m.audio as string, 'base64')
      return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
    })
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  })
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  net.sockets.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OpenAiWhisperSttChannel connect', () => {
  it('reports a missing key instead of opening a socket, and stays inert', () => {
    const { ch, statuses } = make({ apiKey: '' })
    ch.send(chunk(1, 2, 3))
    ch.close()
    expect(net.sockets).toHaveLength(0)
    expect(statuses[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('OpenAI') })
  })

  it('opens the realtime transcription endpoint with the key as a bearer token', () => {
    make()
    expect(lastSocket().url).toBe('wss://api.openai.com/v1/realtime?intent=transcription')
    expect(lastSocket().opts.headers.authorization).toBe('Bearer oa-key')
  })

  it.each([
    ['ru', { model: 'gpt-4o-transcribe', language: 'ru' }],
    ['multi', { model: 'gpt-4o-transcribe' }],
    ['', { model: 'gpt-4o-transcribe' }]
  ])('configures server-side VAD and transcription for language %j', (language, expected) => {
    make({ language })
    lastSocket().emit('open')
    expect(lastSocket().sent[0]).toEqual({
      type: 'transcription_session.update',
      session: {
        input_audio_format: 'pcm16',
        input_audio_transcription: expected,
        turn_detection: { type: 'server_vad' }
      }
    })
  })
})

describe('OpenAiWhisperSttChannel audio', () => {
  it('upsamples the 16 kHz capture to the 24 kHz the API requires', () => {
    const { ch } = make()
    lastSocket().emit('open')
    ch.send(new Int16Array(1600).fill(1000).buffer)

    const [sent] = appended(lastSocket())
    expect(sent).toHaveLength(2400)
    expect(Math.abs(sent![1200]! - 1000)).toBeLessThan(2)
  })

  it('queues audio captured before the socket opens and sends it after the session config', () => {
    const { ch } = make()
    ch.send(chunk(10, 10, 10, 10))
    ch.send(chunk(20, 20, 20, 20))
    lastSocket().emit('open')

    expect(lastSocket().sent.map((m) => m.type)).toEqual([
      'transcription_session.update',
      'input_audio_buffer.append',
      'input_audio_buffer.append'
    ])
    expect(appended(lastSocket()).map((a) => a[0])).toEqual([10, 20])
  })

  it('keeps at most 25 queued chunks while the socket is down', () => {
    const { ch } = make()
    for (let i = 0; i < 40; i++) ch.send(chunk(i, i))
    lastSocket().emit('open')
    expect(appended(lastSocket())).toHaveLength(25)
  })

  it('ignores audio after close', () => {
    const { ch } = make()
    lastSocket().emit('open')
    ch.close()
    ch.send(chunk(1, 2))
    expect(appended(lastSocket())).toHaveLength(0)
  })
})

describe('OpenAiWhisperSttChannel transcripts', () => {
  it('grows one interim per spoken item and finalizes it with the completed transcript', () => {
    const { segments } = make()
    const sock = lastSocket()
    sock.emit('open')

    say(sock, delta('a', 'Hel'))
    say(sock, delta('b', 'Привет'))
    say(sock, delta('a', 'lo'))
    say(sock, completed('a', ' Hello there. '))
    say(sock, delta('a', 'Next'))

    expect(segments.map((s) => [s.text, s.isFinal])).toEqual([
      ['Hel', false],
      ['Привет', false],
      ['Hello', false],
      ['Hello there.', true],
      ['Next', false]
    ])
  })

  it('stamps segments from the audio streamed so far and tells the two channels apart', () => {
    const mic = make()
    const micSock = lastSocket()
    micSock.emit('open')
    const system = make({ channel: 'system' })
    const systemSock = lastSocket()
    systemSock.emit('open')

    mic.ch.send(new Int16Array(16_000).buffer)
    say(micSock, completed('a', 'one second in'))
    mic.ch.send(new Int16Array(8_000).buffer)
    say(micSock, delta('b', 'half'))
    system.ch.send(new Int16Array(4_000).buffer)
    say(systemSock, completed('c', 'them'))

    expect(mic.segments).toMatchObject([
      { text: 'one second in', speaker: 0, startMs: 0, endMs: 1000, channel: 'mic' },
      { text: 'half', speaker: 0, startMs: 1000, endMs: 1500, isFinal: false }
    ])
    expect(system.segments).toMatchObject([
      { text: 'them', speaker: 1, startMs: 0, endMs: 250, channel: 'system' }
    ])
  })

  it('ignores blank transcripts, unparseable frames and events it does not know', () => {
    const { segments, statuses } = make()
    const sock = lastSocket()
    sock.emit('open')

    say(sock, completed('a', '   '))
    sock.emit('message', 'definitely not json')
    say(sock, { type: 'session.updated' })

    expect(segments).toEqual([])
    expect(statuses.map((s) => s.kind)).toEqual(['connecting', 'open'])
  })

  it('surfaces a failed transcription as an error but keeps the socket and the call going', () => {
    const { segments, statuses } = make()
    const sock = lastSocket()
    sock.emit('open')

    say(sock, {
      type: 'conversation.item.input_audio_transcription.failed',
      error: { message: 'audio too short' }
    })
    say(sock, { type: 'error' })
    say(sock, completed('a', 'still working'))

    expect(statuses).toContainEqual({ kind: 'error', channel: 'mic', message: 'audio too short' })
    expect(statuses).toContainEqual({
      kind: 'error',
      channel: 'mic',
      message: 'transcription error'
    })
    expect(sock.terminated).toBe(false)
    expect(segments.map((s) => s.text)).toEqual(['still working'])
  })
})

describe('OpenAiWhisperSttChannel reconnect', () => {
  it('terminates a dropped socket, reconnects after a second and replays the gap', () => {
    const { ch, statuses } = make()
    const first = lastSocket()
    first.emit('open')

    first.emit('close')
    expect(first.terminated).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    ch.send(chunk(5, 5))
    first.emit('close')

    vi.advanceTimersByTime(999)
    expect(net.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(net.sockets).toHaveLength(2)
    lastSocket().emit('open')
    expect(appended(lastSocket()).map((a) => a[0])).toEqual([5])
    expect(statuses.at(-1)).toEqual({ kind: 'open', channel: 'mic' })
  })

  it('reports a socket error and reconnects', () => {
    const { statuses } = make()
    const first = lastSocket()
    first.emit('open')

    first.emit('error', new Error('ECONNRESET'))
    expect(statuses).toContainEqual({ kind: 'error', channel: 'mic', message: 'ECONNRESET' })
    expect(first.terminated).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(net.sockets).toHaveLength(2)
  })

  it('backs off 1s, 2s, 4s... capped at 30s, and gives up after ten retries', () => {
    const { statuses } = make()
    const openedAt: number[] = [Date.now()]
    for (let i = 0; i < 12; i++) {
      lastSocket().emit('close')
      const before = net.sockets.length
      for (let step = 0; step < 31 && net.sockets.length === before; step++) {
        vi.advanceTimersByTime(1000)
      }
      if (net.sockets.length > before) openedAt.push(Date.now())
    }

    const gaps = openedAt.slice(1).map((t, i) => t - openedAt[i]!)
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000])
    expect(net.sockets).toHaveLength(11)
    expect(statuses.at(-1)).toEqual({
      kind: 'error',
      channel: 'mic',
      message: 'reconnect attempts exhausted'
    })
  })

  it('starts the backoff over once a reconnect opens', () => {
    make()
    lastSocket().emit('close')
    vi.advanceTimersByTime(1000)
    lastSocket().emit('close')
    vi.advanceTimersByTime(2000)
    lastSocket().emit('open')

    lastSocket().emit('close')
    vi.advanceTimersByTime(1000)

    expect(net.sockets).toHaveLength(4)
  })

  it('pings a quiet socket and keeps it while pongs come back', () => {
    make()
    const sock = lastSocket()
    sock.emit('open')

    for (let i = 0; i < 24; i++) {
      vi.advanceTimersByTime(5000)
      sock.emit('pong')
    }

    expect(sock.pings).toBe(24)
    expect(sock.terminated).toBe(false)
  })

  it('reconnects when pings go unanswered', () => {
    const { statuses } = make()
    const sock = lastSocket()
    sock.emit('open')

    vi.advanceTimersByTime(24_000)
    expect(sock.terminated).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(sock.terminated).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    vi.advanceTimersByTime(1000)
    expect(net.sockets).toHaveLength(2)
  })
})

describe('OpenAiWhisperSttChannel close', () => {
  it('stops reconnecting and announces the close', () => {
    const { ch, statuses } = make()
    const sock = lastSocket()
    sock.emit('open')
    sock.emit('close')

    ch.close()
    vi.advanceTimersByTime(120_000)
    sock.emit('close')
    vi.advanceTimersByTime(120_000)

    expect(net.sockets).toHaveLength(1)
    expect(statuses.at(-1)).toEqual({ kind: 'closed', channel: 'mic' })
  })

  it('still delivers the final that was draining when the call was stopped', () => {
    const { ch, segments } = make()
    const sock = lastSocket()
    sock.emit('open')
    ch.send(new Int16Array(16_000).buffer)

    ch.close()
    expect(sock.closed).toBe(true)
    say(sock, completed('a', 'and that is all'))

    expect(segments).toMatchObject([{ text: 'and that is all', isFinal: true, endMs: 1000 }])
  })
})
