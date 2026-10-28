import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { PARAKEET_DIR, PARAKEET_FILES } from './models.js'
import type { SpeechSegment } from './protocol.js'

const SAMPLE_RATE = 16_000

interface SherpaVadSegment {
  start: number
  samples: Float32Array
}

interface SherpaVad {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  front(enableExternalBuffer: boolean): SherpaVadSegment
  pop(): void
  flush(): void
}

interface SherpaStream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void
}

interface SherpaRecognizer {
  createStream(): SherpaStream
  decodeAsync(stream: SherpaStream): Promise<{ text: string }>
}

interface SherpaModule {
  OfflineRecognizer: { createAsync(config: object): Promise<SherpaRecognizer> }
  Vad: new (config: object, bufferSizeInSeconds: number) => SherpaVad
}

interface SpeechStream {
  vad: SherpaVad
  // Decodes run one after another so each feed returns its phrases in order.
  decoded: Promise<unknown>
}

export interface Parakeet {
  load(): Promise<void>
  feed(stream: string, samples: Float32Array): Promise<SpeechSegment[]>
  end(stream: string): Promise<SpeechSegment[]>
}

/**
 * Parakeet v3 behind Silero VAD: audio is cut at pauses and each phrase is
 * decoded whole, so words are never split the way fixed-length batches split them.
 * The model is never unloaded here; the worker process exits once idle.
 */
export function createParakeet(modelsDir: string): Parakeet {
  const dir = join(modelsDir, PARAKEET_DIR)
  const streams = new Map<string, SpeechStream>()
  let loading: Promise<{ sherpa: SherpaModule; recognizer: SherpaRecognizer }> | null = null

  function load(): NonNullable<typeof loading> {
    if (!loading) {
      const attempt = (async () => {
        await ensureFiles(dir)
        // A CommonJS package: Node's static scan finds only some of its exports, so
        // take them from module.exports.
        const sherpa = ((await import('sherpa-onnx-node')) as { default: SherpaModule }).default
        const recognizer = await sherpa.OfflineRecognizer.createAsync({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: join(dir, 'encoder.int8.onnx'),
              decoder: join(dir, 'decoder.int8.onnx'),
              joiner: join(dir, 'joiner.int8.onnx')
            },
            tokens: join(dir, 'tokens.txt'),
            modelType: 'nemo_transducer',
            numThreads: 2
          }
        })
        return { sherpa, recognizer }
      })()
      loading = attempt
      // A failed download or load must not stick; the next request retries it.
      attempt.catch(() => {
        if (loading === attempt) loading = null
      })
    }
    return loading
  }

  function decodeReady(
    recognizer: SherpaRecognizer,
    stream: SpeechStream
  ): Promise<SpeechSegment[]> {
    const ready: SherpaVadSegment[] = []
    while (!stream.vad.isEmpty()) {
      ready.push(stream.vad.front(false))
      stream.vad.pop()
    }
    const run = stream.decoded.then(async () => {
      const out: SpeechSegment[] = []
      for (const segment of ready) {
        const input = recognizer.createStream()
        input.acceptWaveform({ samples: segment.samples, sampleRate: SAMPLE_RATE })
        const text = (await recognizer.decodeAsync(input)).text.trim()
        if (!text) continue
        out.push({
          text,
          startMs: toMs(segment.start),
          endMs: toMs(segment.start + segment.samples.length)
        })
      }
      return out
    })
    stream.decoded = run.catch(() => {})
    return run
  }

  return {
    load: async () => {
      await load()
    },
    feed: async (id, samples) => {
      const { sherpa, recognizer } = await load()
      let stream = streams.get(id)
      if (!stream) {
        stream = { vad: createVad(sherpa, dir), decoded: Promise.resolve() }
        streams.set(id, stream)
      }
      stream.vad.acceptWaveform(samples)
      return decodeReady(recognizer, stream)
    },
    end: async (id) => {
      const stream = streams.get(id)
      if (!stream) return []
      streams.delete(id)
      const { recognizer } = await load()
      stream.vad.flush()
      return decodeReady(recognizer, stream)
    }
  }
}

function createVad(sherpa: SherpaModule, dir: string): SherpaVad {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: join(dir, 'silero_vad.onnx'),
        threshold: 0.5,
        minSilenceDuration: 0.4,
        minSpeechDuration: 0.25,
        // Speech with no pause this long is cut anyway, so a monologue still
        // reaches the transcript every few seconds.
        maxSpeechDuration: 10,
        windowSize: 512
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1
    },
    30
  )
}

function toMs(sample: number): number {
  return Math.round((sample / SAMPLE_RATE) * 1000)
}

async function ensureFiles(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  for (const file of PARAKEET_FILES) {
    const dest = join(dir, file.name)
    const present = await access(dest).then(
      () => true,
      () => false
    )
    if (!present) await download(file.url, dest, file.sha256)
  }
}

// Written to a .part file and renamed only once the checksum matches, so a
// file under its final name is always complete.
async function download(url: string, dest: string, sha256: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Speech model download failed (${res.status}): ${url}`)
  const hash = createHash('sha256')
  const part = `${dest}.part`
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        done(null, chunk)
      }
    }),
    createWriteStream(part)
  )
  if (hash.digest('hex') !== sha256) {
    await rm(part, { force: true })
    throw new Error(`Speech model file failed its checksum: ${url}`)
  }
  await rename(part, dest)
}
