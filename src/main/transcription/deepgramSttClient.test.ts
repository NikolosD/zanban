import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { DeepgramSttChannelOptions } from './deepgramSttClient.js'

type Handler = (payload?: unknown) => void

const sdk = vi.hoisted(() => {
  class Connection {
    handlers = new Map<string, Handler>()
    media: number[][] = []
    keepAlives = 0
    closed = false
    on(event: string, cb: Handler): void {
      this.handlers.set(event, cb)
    }
    connect(): void {}
    async waitForOpen(): Promise<void> {}
    sendMedia(data: Buffer | ArrayBuffer): void {
      this.media.push(
        Array.from(new Int16Array(Uint8Array.from(Buffer.from(data as Buffer)).buffer))
      )
    }
    sendKeepAlive(): void {
      this.keepAlives += 1
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
    params: [] as Array<Record<string, string>>,
    failWith: null as Error | null,
    gate: null as Promise<void> | null
  }
})

vi.mock('@deepgram/sdk', () => ({
  DeepgramClient: class {
    listen = {
      v1: {
        connect: async (params: Record<string, string>) => {
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

const { DeepgramSttChannel } = await import('./deepgramSttClient.js')

function make(over: Partial<DeepgramSttChannelOptions> = {}) {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new DeepgramSttChannel({
    apiKey: 'dg-key',
    language: 'en',
    channel: 'mic',
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

function results(text: string | null | undefined, over: Record<string, unknown> = {}): unknown {
  return {
    type: 'Results',
    channel: { alternatives: [{ transcript: text }] },
    is_final: true,
    start: 0,
    duration: 0,
    ...over
  }
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

describe('DeepgramSttChannel connect', () => {
  it('reports a missing API key instead of connecting', async () => {
    const { statuses } = make({ apiKey: '' })
    await settle()
    expect(statuses).toEqual([
      { kind: 'error', channel: 'mic', message: 'Deepgram API key required' }
    ])
    expect(sdk.attempts).toHaveLength(0)
  })

  it.each([
    ['en', 'en'],
    ['multi', 'multi'],
    ['ru', 'multi'],
    ['sw', 'multi']
  ])(
    'asks for %s as %s, since only English is pinned and the rest go multilingual',
    async (picked, sent) => {
      make({ language: picked })
      await settle()
      expect(sdk.params[0]).toMatchObject({
        model: 'nova-3',
        language: sent,
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true'
      })
    }
  )
})

describe('DeepgramSttChannel audio', () => {
  it('holds audio captured while the socket opens and replays it in order on open', async () => {
    const { ch, statuses } = make()
    ch.send(chunk(1))
    ch.send(chunk(2))
    await settle()
    expect(lastConn().media).toEqual([])

    lastConn().emit('open')
    expect(lastConn().media).toEqual([[1], [2]])
    ch.send(chunk(3))
    expect(lastConn().media).toEqual([[1], [2], [3]])
    expect(statuses.map((s) => s.kind)).toEqual(['connecting', 'open'])
  })

  it('bounds the backlog while disconnected to about three seconds of audio', async () => {
    const { ch } = make()
    for (let i = 0; i < 40; i++) ch.send(chunk(i))
    await settle()
    lastConn().emit('open')
    expect(lastConn().media).toHaveLength(25)
  })

  it('ignores audio after close', async () => {
    const { ch } = make()
    await settle()
    lastConn().emit('open')
    ch.close()
    ch.send(chunk(1))
    expect(lastConn().media).toEqual([])
  })
})

describe('DeepgramSttChannel results', () => {
  it('turns finals and interims into trimmed segments with millisecond timing', async () => {
    const { segments } = make({ channel: 'system' })
    await settle()
    const conn = lastConn()
    conn.emit('open')

    conn.emit('message', results('  Привет, мир 👋  ', { start: 1.5, duration: 2.25 }))
    conn.emit('message', results('how are', { is_final: false, start: 4, duration: 0.5 }))

    expect(segments).toMatchObject([
      { text: 'Привет, мир 👋', isFinal: true, startMs: 1500, endMs: 3750, channel: 'system' },
      { text: 'how are', isFinal: false, startMs: 4000, endMs: 4500, channel: 'system' }
    ])
  })

  it('drops metadata, blank and missing transcripts', async () => {
    const { segments } = make()
    await settle()
    const conn = lastConn()
    conn.emit('open')

    conn.emit('message', { type: 'Metadata' })
    conn.emit('message', results('   '))
    conn.emit('message', results(null))
    conn.emit('message', { type: 'Results', channel: { alternatives: [] } })

    expect(segments).toEqual([])
  })
})

describe('DeepgramSttChannel reconnect', () => {
  it('reconnects after the socket drops and replays what was said during the gap', async () => {
    const { ch, statuses } = make()
    await settle()
    const first = lastConn()
    first.emit('open')

    first.emit('close')
    expect(first.closed).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    ch.send(chunk(7))
    expect(first.media).toEqual([])

    await tick(999)
    expect(sdk.connections).toHaveLength(1)
    await tick(1)
    expect(sdk.connections).toHaveLength(2)
    sdk.connections[1]!.emit('open')
    expect(sdk.connections[1]!.media).toEqual([[7]])
    expect(statuses.at(-1)).toEqual({ kind: 'open', channel: 'mic' })
  })

  it('reports a socket error with its message and reconnects', async () => {
    const { statuses } = make()
    await settle()
    const first = lastConn()
    first.emit('open')

    first.emit('error', new Error('socket hang up'))
    expect(statuses).toContainEqual({ kind: 'error', channel: 'mic', message: 'socket hang up' })
    first.emit('close')

    await tick(1000)
    expect(sdk.connections).toHaveLength(2)
  })

  it('backs off 1s, 2s, 4s... capped at 30s, and gives up after ten retries', async () => {
    sdk.failWith = new Error('ENOTFOUND api.deepgram.com')
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
    await runFor(300_000, 5_000)
    expect(sdk.attempts).toHaveLength(11)
  })

  it('starts the backoff over after a successful reconnect', async () => {
    sdk.failWith = new Error('boom')
    make()
    await settle()
    await runFor(3_000)
    sdk.failWith = null
    await runFor(4_000)
    expect(sdk.connections).toHaveLength(1)

    lastConn().emit('open')
    lastConn().emit('close')
    await tick(1000)

    expect(sdk.connections).toHaveLength(2)
  })

  it('reconnects when audio keeps flowing but the server stops answering', async () => {
    const { ch, statuses } = make()
    await settle()
    const first = lastConn()
    first.emit('open')
    ch.send(chunk(1))

    await tick(19_000)
    expect(first.closed).toBe(false)
    await tick(6_000)
    expect(first.closed).toBe(true)
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    await tick(1000)
    expect(sdk.connections).toHaveLength(2)
  })

  it('stays connected while the server keeps answering', async () => {
    const { ch } = make()
    await settle()
    const first = lastConn()
    first.emit('open')

    for (let i = 0; i < 20; i++) {
      ch.send(chunk(1))
      await tick(3_000)
      first.emit('message', { type: 'Metadata' })
    }

    expect(first.closed).toBe(false)
    expect(sdk.connections).toHaveLength(1)
  })

  it('keeps an idle socket alive with a KeepAlive every 8 seconds, and stops after close', async () => {
    const { ch } = make()
    await settle()
    lastConn().emit('open')

    await tick(24_000)
    expect(lastConn().keepAlives).toBe(3)
    ch.close()
    await tick(24_000)
    expect(lastConn().keepAlives).toBe(3)
  })
})

describe('DeepgramSttChannel close', () => {
  it('closes the socket, cancels the pending reconnect and ignores late events', async () => {
    const { ch, statuses } = make()
    await settle()
    const first = lastConn()
    first.emit('open')
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
    expect(sdk.connections[0]!.closed).toBe(true)
    expect(sdk.connections[0]!.handlers.size).toBe(0)
  })
})
