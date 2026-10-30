import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { GoogleSttChannelOptions } from './googleSttClient.js'

type Handler = (payload?: unknown) => void

const sdk = vi.hoisted(() => {
  class Stream {
    handlers = new Map<string, Handler>()
    written: Array<Record<string, any>> = []
    ended = false
    on(event: string, cb: Handler): void {
      this.handlers.set(event, cb)
    }
    write(msg: Record<string, any>): void {
      this.written.push(msg)
    }
    end(): void {
      this.ended = true
    }
    emit(event: string, payload?: unknown): void {
      this.handlers.get(event)?.(payload)
    }
  }
  class Client {
    closed = false
    constructor(readonly opts: Record<string, any>) {
      clients.push(this)
    }
    _streamingRecognize(): Stream {
      attempts.push(Date.now())
      const stream = new Stream()
      streams.push(stream)
      return stream
    }
    async close(): Promise<void> {
      this.closed = true
    }
  }
  const clients: Client[] = []
  const streams: Stream[] = []
  const attempts: number[] = []
  return { Client, Stream, clients, streams, attempts }
})

vi.mock('@google-cloud/speech', () => ({ v2: { SpeechClient: sdk.Client } }))

const { GoogleSttChannel } = await import('./googleSttClient.js')

function make(over: Partial<GoogleSttChannelOptions> = {}) {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new GoogleSttChannel({
    projectId: 'gcp-project',
    serviceAccountJson: null,
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

function chunk(...samples: number[]): ArrayBuffer {
  return new Int16Array(samples).buffer
}

function lastStream(): InstanceType<typeof sdk.Stream> {
  return sdk.streams.at(-1)!
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  })
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  sdk.clients.length = 0
  sdk.streams.length = 0
  sdk.attempts.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GoogleSttChannel connect', () => {
  it('reports a missing project id instead of connecting', async () => {
    const { statuses } = make({ projectId: '' })
    await settle()
    expect(statuses).toEqual([
      { kind: 'error', channel: 'mic', message: 'Google project ID required' }
    ])
    expect(sdk.clients).toHaveLength(0)
  })

  it.each([
    ['not json at all', 'Service account JSON is malformed'],
    ['{"client_email":"bot@gcp.test"}', 'Service account JSON missing client_email / private_key'],
    ['{"private_key":"PEM"}', 'Service account JSON missing client_email / private_key']
  ])('rejects a bad service account (%s) before touching Google', async (json, message) => {
    const { statuses } = make({ serviceAccountJson: json })
    await settle()
    expect(statuses).toEqual([{ kind: 'error', channel: 'mic', message }])
    expect(sdk.clients).toHaveLength(0)
  })

  it('uses application default credentials without a service account, and the EU endpoint', async () => {
    make({ serviceAccountJson: '  ' })
    await settle()
    expect(sdk.clients[0]!.opts).toEqual({
      projectId: 'gcp-project',
      apiEndpoint: 'eu-speech.googleapis.com'
    })
  })

  it('passes only the service account identity on, not the rest of the file', async () => {
    make({
      serviceAccountJson: JSON.stringify({ client_email: 'a@b', private_key: 'K', extra: 1 })
    })
    await settle()
    expect(sdk.clients[0]!.opts.credentials).toEqual({ client_email: 'a@b', private_key: 'K' })
  })

  it.each([
    ['en', ['en-US']],
    ['ru', ['ru-RU', 'en-US']],
    ['multi', ['auto']],
    ['xx', ['auto']]
  ])('opens a Chirp 3 stream for language %s as %j', async (language, languageCodes) => {
    const { statuses } = make({ language })
    await settle()
    expect(lastStream().written[0]).toMatchObject({
      recognizer: 'projects/gcp-project/locations/eu/recognizers/_',
      streamingConfig: {
        config: { languageCodes, model: 'chirp_3' },
        streamingFeatures: { interimResults: true }
      }
    })
    expect(statuses.at(-1)).toEqual({ kind: 'open', channel: 'mic' })
  })
})

describe('GoogleSttChannel audio and results', () => {
  it('drops audio until the stream is ready, then writes it through', async () => {
    const { ch } = make()
    ch.send(chunk(1, 1))
    await settle()
    ch.send(chunk(2, 2))

    const audio = lastStream().written.slice(1)
    expect(audio).toHaveLength(1)
    expect(
      Array.from(new Int16Array(audio[0]!.audio.buffer, audio[0]!.audio.byteOffset, 2))
    ).toEqual([2, 2])
  })

  it('turns results into segments, timing them by the result end offset', async () => {
    const { segments } = make({ channel: 'system' })
    await settle()

    lastStream().emit('data', {
      results: [
        {
          isFinal: true,
          resultEndOffset: { seconds: '3', nanos: 500_000_000 },
          alternatives: [{ transcript: '  Расскажите о себе 🙂 ' }]
        },
        { isFinal: false, resultEndOffset: { seconds: 4 }, alternatives: [{ transcript: 'and' }] },
        { isFinal: true, alternatives: [{ transcript: '   ' }] },
        { isFinal: true, alternatives: [] },
        { isFinal: true, alternatives: null }
      ]
    })
    lastStream().emit('data', {})

    expect(segments).toMatchObject([
      {
        text: 'Расскажите о себе 🙂',
        isFinal: true,
        startMs: 3500,
        endMs: 3500,
        channel: 'system'
      },
      { text: 'and', isFinal: false, endMs: 4000 }
    ])
    expect(segments).toHaveLength(2)
  })
})

describe('GoogleSttChannel reconnect', () => {
  it.each([
    'Stream timed out after receiving no more client requests',
    '14 UNAVAILABLE: connection reset',
    '10 ABORTED: stream aborted',
    '1 CANCELLED: call cancelled'
  ])('treats "%s" as a reconnect in progress, not a user-facing error', async (message) => {
    const { statuses } = make()
    await settle()

    lastStream().emit('error', new Error(message))

    expect(statuses.filter((s) => s.kind === 'error')).toEqual([])
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    await tick(1000)
    expect(sdk.streams).toHaveLength(2)
  })

  it('surfaces a real failure such as a permission error, and still retries', async () => {
    const { statuses } = make()
    await settle()

    lastStream().emit('error', new Error('7 PERMISSION_DENIED: speech.recognizers.recognize'))

    expect(statuses).toContainEqual({
      kind: 'error',
      channel: 'mic',
      message: '7 PERMISSION_DENIED: speech.recognizers.recognize'
    })
    await tick(1000)
    expect(sdk.streams).toHaveLength(2)
  })

  it('reconnects when the stream ends and closes the previous gRPC client', async () => {
    const { statuses } = make()
    await settle()
    const first = sdk.clients[0]!

    lastStream().emit('end')
    expect(statuses.at(-1)).toEqual({ kind: 'connecting', channel: 'mic' })
    await tick(1000)

    expect(sdk.streams).toHaveLength(2)
    expect(sdk.clients).toHaveLength(2)
    expect(first.closed).toBe(true)
    expect(sdk.clients[1]!.closed).toBe(false)
  })

  it('backs off 1s, 2s, 4s, 8s, 15s and then gives up', async () => {
    const { statuses } = make()
    await settle()

    for (let i = 0; i < 6; i++) {
      lastStream().emit('error', new Error('7 PERMISSION_DENIED'))
      const before = sdk.streams.length
      for (let s = 0; s < 16 && sdk.streams.length === before; s++) await tick(1000)
    }

    const gaps = sdk.attempts.slice(1).map((t, i) => t - sdk.attempts[i]!)
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 15000])
    expect(statuses.at(-1)).toEqual({
      kind: 'error',
      channel: 'mic',
      message: 'reconnect attempts exhausted'
    })
    expect(sdk.streams).toHaveLength(6)
  })

  it('gives the retry budget back to a stream that stayed up for five seconds', async () => {
    make()
    await settle()

    lastStream().emit('end')
    await tick(1000)
    lastStream().emit('end')
    await tick(2000)
    expect(sdk.streams).toHaveLength(3)

    await tick(5000)
    lastStream().emit('end')
    await tick(1000)

    expect(sdk.streams).toHaveLength(4)
  })

  it('gives the retry budget back as soon as a stream returns results', async () => {
    make()
    await settle()

    lastStream().emit('end')
    await tick(1000)
    lastStream().emit('end')
    await tick(2000)
    lastStream().emit('data', {
      results: [{ isFinal: false, alternatives: [{ transcript: 'hello' }] }]
    })
    lastStream().emit('end')
    await tick(1000)

    expect(sdk.streams).toHaveLength(4)
  })

  it('does not give the budget back to a stream that fails straight away', async () => {
    make()
    await settle()

    lastStream().emit('end')
    await tick(1000)
    lastStream().emit('end')
    await tick(1000)

    expect(sdk.streams).toHaveLength(2)
    await tick(1000)
    expect(sdk.streams).toHaveLength(3)
  })
})

describe('GoogleSttChannel close', () => {
  it('ends the stream, releases the client, and never reconnects', async () => {
    const { ch } = make()
    await settle()
    const stream = lastStream()
    const client = sdk.clients[0]!

    ch.close()
    stream.emit('end')
    stream.emit('error', new Error('late'))
    await tick(120_000)

    expect(stream.ended).toBe(true)
    expect(client.closed).toBe(true)
    expect(sdk.streams).toHaveLength(1)
    ch.send(chunk(1, 1))
    expect(stream.written).toHaveLength(1)
  })

  it('cancels a reconnect that was already scheduled', async () => {
    const { ch } = make()
    await settle()
    lastStream().emit('end')

    ch.close()
    await tick(120_000)

    expect(sdk.streams).toHaveLength(1)
  })
})
