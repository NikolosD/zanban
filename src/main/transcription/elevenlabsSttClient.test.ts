import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { ElevenLabsSttOptions } from './elevenlabsSttClient.js'

type Handler = (payload?: unknown) => void

const sdk = vi.hoisted(() => {
  class Connection {
    handlers = new Map<string, Handler>()
    socketHandlers = new Map<string, Handler>()
    sent: number[][] = []
    closed = false
    pings = 0
    websocket = {
      on: (event: string, cb: Handler): void => {
        this.socketHandlers.set(event, cb)
      },
      ping: (): void => {
        this.pings += 1
      }
    }
    on(event: string, cb: Handler): void {
      this.handlers.set(event, cb)
    }
    send(msg: { audioBase64: string }): void {
      const bytes = Buffer.from(msg.audioBase64, 'base64')
      this.sent.push(Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)))
    }
    close(): void {
      this.closed = true
    }
    emit(event: string, payload?: unknown): void {
      this.handlers.get(event)?.(payload)
    }
  }
  return {
    Connection,
    connections: [] as Connection[],
    attempts: [] as number[],
    params: [] as Array<Record<string, unknown>>,
    failWith: null as Error | null,
    gate: null as Promise<void> | null
  }
})

vi.mock('@elevenlabs/elevenlabs-js', () => ({
  AudioFormat: { PCM_16000: 'pcm_16000' },
  CommitStrategy: { VAD: 'vad' },
  RealtimeEvents: {
    PARTIAL_TRANSCRIPT: 'partial',
    COMMITTED_TRANSCRIPT: 'committed',
    ERROR: 'error',
    CLOSE: 'close'
  },
  ElevenLabsClient: class {
    speechToText = {
      realtime: {
        connect: async (params: Record<string, unknown>) => {
          sdk.attempts.push(Date.now())
          sdk.params.push(params)
          await sdk.gate
          if (sdk.failWith) throw sdk.failWith
          const conn = new sdk.Connection()
          sdk.connections.push(conn)
          return conn
        }
      }
    }
  }
}))

const { ElevenLabsSttChannel } = await import('./elevenlabsSttClient.js')

function make(over: Partial<ElevenLabsSttOptions> = {}) {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new ElevenLabsSttChannel({
    apiKey: 'el-key',
    channel: 'mic',
    language: 'en',
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s),
    ...over
  })
  return { ch, segments, statuses }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function tick(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await settle()
}

async function runFor(ms: number, step = 500): Promise<void> {
  for (let t = 0; t < ms; t += step) await tick(step)
}

function chunk(...samples: number[]): ArrayBuffer {
  return new Int16Array(samples).buffer
}

function lastConn(): InstanceType<typeof sdk.Connection> {
  return sdk.connections.at(-1)!
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  })
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  sdk.connections.length = 0
  sdk.attempts.length = 0
  sdk.params.length = 0
  sdk.failWith = null
  sdk.gate = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ElevenLabsSttChannel connect', () => {
  it('reports a missing key instead of connecting, and stays inert', async () => {
    const { ch, statuses } = make({ apiKey: '' })
    ch.send(chunk(1, 2))
    ch.close()
    await settle()
    expect(sdk.attempts).toHaveLength(0)
    expect(statuses[0]).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('ElevenLabs')
    })
  })

  it.each([
    ['en', { languageCode: 'en' }],
    ['ru', { languageCode: 'ru' }],
    ['multi', {}]
  ])('requests Scribe v2 realtime with server VAD for language %s', async (language, extra) => {
    make({ language })
    await settle()
    expect(sdk.params[0]).toEqual({
      modelId: 'scribe_v2_realtime',
      audioFormat: 'pcm_16000',
      sampleRate: 16_000,
      commitStrategy: 'vad',
      ...extra
    })
  })

  it('marks the channel open once connected', async () => {
    const { statuses } = make()
    await settle()
    expect(statuses).toEqual([
      { kind: 'connecting', channel: 'mic' },
      { kind: 'open', channel: 'mic' }
    ])
  })
})

describe('ElevenLabsSttChannel audio', () => {
  it('sends audio queued during connect first and in order, then streams directly', async () => {
    const { ch } = make()
    ch.send(chunk(1, 1))
    ch.send(chunk(2, 2))
    await settle()
    ch.send(chunk(3, 3))
    expect(lastConn().sent).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ])
  })

  it('keeps at most 25 queued chunks while connecting', async () => {
    const { ch } = make()
    for (let i = 0; i < 40; i++) ch.send(chunk(i, i))
    await settle()
    expect(lastConn().sent).toHaveLength(25)
  })
})

describe('ElevenLabsSttChannel transcripts', () => {
  it('shows partials as interims and committed text as finals, stamped from the audio streamed', async () => {
    const { ch, segments } = make({ channel: 'system' })
    await settle()
    const conn = lastConn()

    ch.send(new Int16Array(16_000).buffer)
    conn.emit('partial', { text: 'hello th' })
    conn.emit('committed', { text: '  Hello there, привет  ' })
    ch.send(new Int16Array(8_000).buffer)
    conn.emit('partial', { text: 'next' })

    expect(segments).toMatchObject([
      { text: 'hello th', isFinal: false, startMs: 0, endMs: 1000, speaker: 1, channel: 'system' },
      { text: 'Hello there, привет', isFinal: true, startMs: 0, endMs: 1000 },
      { text: 'next', isFinal: false, startMs: 1000, endMs: 1500 }
    ])
  })

  it('drops blank text', async () => {
    const { segments } = make()
    await settle()
    lastConn().emit('partial', { text: '' })
    lastConn().emit('committed', { text: '   ' })
    expect(segments).toEqual([])
  })
})

describe('ElevenLabsSttChannel reconnect', () => {
  it('reconnects after the connection closes and replays what was said during the gap', async () => {
    const { ch, statuses } = make()
    await settle()
    const first = lastConn()

    first.emit('close')
    expect(first.closed).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    ch.send(chunk(9, 9))
    expect(first.sent).toEqual([])

    await tick(999)
    expect(sdk.connections).toHaveLength(1)
    await tick(1)
    expect(sdk.connections).toHaveLength(2)
    expect(lastConn().sent).toEqual([[9, 9]])
    expect(statuses.at(-1)).toEqual({ kind: 'open', channel: 'mic' })
  })

  it.each([
    ['an Error', new Error('quota_exceeded'), 'quota_exceeded'],
    ['a payload', { error: 'invalid_api_key' }, 'invalid_api_key']
  ])('reports %s from the socket and reconnects', async (_label, payload, message) => {
    const { statuses } = make()
    await settle()

    lastConn().emit('error', payload)
    expect(statuses).toContainEqual({ kind: 'error', channel: 'mic', message })

    await tick(1000)
    expect(sdk.connections).toHaveLength(2)
  })

  it('backs off 1s, 2s, 4s... capped at 30s, and gives up after ten retries', async () => {
    sdk.failWith = new Error('503 service unavailable')
    const { statuses } = make()
    await settle()

    await runFor(200_000)

    const gaps = sdk.attempts.slice(1).map((t, i) => t - sdk.attempts[i]!)
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000])
    expect(statuses.at(-1)).toEqual({
      kind: 'error',
      channel: 'mic',
      message: 'reconnect attempts exhausted'
    })
  })

  it('starts the backoff over after a successful reconnect', async () => {
    sdk.failWith = new Error('boom')
    make()
    await settle()
    await runFor(3_000)
    sdk.failWith = null
    await runFor(4_000)
    expect(sdk.connections).toHaveLength(1)

    lastConn().emit('close')
    await tick(1000)

    expect(sdk.connections).toHaveLength(2)
  })

  it('reconnects when pings go unanswered, and stays when pongs return', async () => {
    make()
    await settle()
    const first = lastConn()

    for (let i = 0; i < 6; i++) {
      await tick(5_000)
      first.socketHandlers.get('pong')?.()
    }
    expect(first.pings).toBe(6)
    expect(first.closed).toBe(false)

    await tick(24_000)
    expect(first.closed).toBe(false)
    await tick(1_000)
    expect(first.closed).toBe(true)
    await tick(1_000)
    expect(sdk.connections).toHaveLength(2)
  })
})

describe('ElevenLabsSttChannel close', () => {
  it('closes the connection, cancels the pending reconnect and ignores late events', async () => {
    const { ch, statuses } = make()
    await settle()
    const first = lastConn()
    first.emit('close')

    ch.close()
    await tick(120_000)
    first.emit('close')
    first.emit('error', new Error('late'))
    await tick(120_000)

    expect(sdk.connections).toHaveLength(1)
    expect(statuses.at(-1)).toEqual({ kind: 'closed', channel: 'mic' })
  })

  it('releases a connection that finishes opening after the channel was closed', async () => {
    let release = (): void => {}
    sdk.gate = new Promise<void>((resolve) => (release = resolve))
    const { ch } = make()
    await settle()

    ch.close()
    release()
    await settle()

    expect(sdk.connections).toHaveLength(1)
    expect(lastConn().closed).toBe(true)
    expect(lastConn().handlers.size).toBe(0)
  })
})
