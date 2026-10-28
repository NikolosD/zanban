import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

vi.mock('./models.js', () => ({
  PARAKEET_DIR: 'parakeet',
  PARAKEET_FILES: [
    { name: 'model.onnx', url: 'https://hf.test/model.onnx', sha256: sha('model'), bytes: 5 },
    { name: 'vad.onnx', url: 'https://hf.test/vad.onnx', sha256: sha('vad'), bytes: 3 }
  ]
}))

const sherpa = vi.hoisted(() => ({
  failNextLoad: false,
  // Each acceptWaveform call closes one segment per entry, at the given sample.
  segmentsPerFeed: [] as Array<Array<{ start: number; length: number }>>,
  decoded: [] as number[]
}))

vi.mock('sherpa-onnx-node', () => ({
  default: {
    OfflineRecognizer: {
      createAsync: async () => {
        if (sherpa.failNextLoad) {
          sherpa.failNextLoad = false
          throw new Error('bad model')
        }
        return {
          createStream: () => {
            let length = 0
            return {
              acceptWaveform: (wave: { samples: Float32Array }) => (length = wave.samples.length),
              get length() {
                return length
              }
            }
          },
          decodeAsync: async (stream: { length: number }) => {
            sherpa.decoded.push(stream.length)
            return { text: stream.length === 0 ? ' ' : ` phrase of ${stream.length} ` }
          }
        }
      }
    },
    Vad: class {
      private queue: Array<{ start: number; samples: Float32Array }> = []
      acceptWaveform(): void {
        for (const s of sherpa.segmentsPerFeed.shift() ?? []) {
          this.queue.push({ start: s.start, samples: new Float32Array(s.length) })
        }
      }
      isEmpty(): boolean {
        return this.queue.length === 0
      }
      front(): { start: number; samples: Float32Array } {
        return this.queue[0]!
      }
      pop(): void {
        this.queue.shift()
      }
      flush(): void {
        this.queue.push({ start: 48_000, samples: new Float32Array(8_000) })
      }
    }
  }
}))

const { createParakeet } = await import('./parakeet.js')

describe('createParakeet', () => {
  let dir: string
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.endsWith('model.onnx') ? 'model' : 'vad'
    return new Response(body, { status: 200 })
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zanban-parakeet-'))
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    sherpa.failNextLoad = false
    sherpa.segmentsPerFeed = []
    sherpa.decoded = []
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(dir, { recursive: true, force: true })
  })

  it('downloads the model once and reuses the files on the next load', async () => {
    await createParakeet(dir).load()
    expect((await readdir(join(dir, 'parakeet'))).sort()).toEqual(['model.onnx', 'vad.onnx'])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await createParakeet(dir).load()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports how much of the first-run download is done', async () => {
    const seen: number[] = []
    await createParakeet(dir).load((p) => seen.push(p))
    expect(seen).toEqual([5 / 8, 1])
  })

  it('refuses a download whose checksum does not match and leaves nothing behind', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('tampered', { status: 200 }))
    await expect(createParakeet(dir).load()).rejects.toThrow('failed its checksum')
    expect(await readdir(join(dir, 'parakeet'))).toEqual([])
  })

  it('retries a failed load on the next request', async () => {
    const parakeet = createParakeet(dir)
    sherpa.failNextLoad = true
    await expect(parakeet.load()).rejects.toThrow('bad model')
    await expect(parakeet.load()).resolves.toBeUndefined()
  })

  it('returns each finished phrase with its time in the stream, in order', async () => {
    const parakeet = createParakeet(dir)
    sherpa.segmentsPerFeed = [
      [],
      [
        { start: 0, length: 16_000 },
        { start: 24_000, length: 8_000 }
      ]
    ]
    expect(await parakeet.feed('mic', new Float32Array(1600))).toEqual([])
    expect(await parakeet.feed('mic', new Float32Array(1600))).toEqual([
      { text: 'phrase of 16000', startMs: 0, endMs: 1000 },
      { text: 'phrase of 8000', startMs: 1500, endMs: 2000 }
    ])
  })

  it('flushes the phrase still being spoken when the stream ends', async () => {
    const parakeet = createParakeet(dir)
    await parakeet.feed('mic', new Float32Array(1600))
    expect(await parakeet.end('mic')).toEqual([
      { text: 'phrase of 8000', startMs: 3000, endMs: 3500 }
    ])
    expect(await parakeet.end('mic')).toEqual([])
  })

  it('drops phrases that decode to nothing', async () => {
    const parakeet = createParakeet(dir)
    sherpa.segmentsPerFeed = [[{ start: 0, length: 0 }]]
    expect(await parakeet.feed('mic', new Float32Array(1600))).toEqual([])
    expect(sherpa.decoded).toEqual([0])
  })
})
