import { IdleResource } from '../services/idleResource.js'
import { loadTransformers, type TransformersPipeline } from '../services/transformers.js'
import { LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_REVISION, WHISPER_MODEL } from './models.js'
import { createParakeet } from './parakeet.js'
import type { MlModel, MlResults, MlTask } from './protocol.js'

type Asr = TransformersPipeline &
  ((
    input: Float32Array,
    opts?: { language?: string; task?: string; chunk_length_s?: number }
  ) => Promise<{ text?: string }>)

type Extractor = TransformersPipeline &
  ((
    input: string,
    opts: { pooling: 'mean'; normalize: boolean }
  ) => Promise<{ data: Float32Array }>)

// An open channel sends a batch every 5 s, so this only fires once the call is over.
const WHISPER_IDLE_MS = 60_000
// The loaded encoder holds ~700 MB, and RAG runs in bursts (an ask, an index
// flush), so it is dropped between them and reloaded from the disk cache.
const EMBEDDER_IDLE_MS = 5 * 60_000

type Handlers = {
  [K in MlTask['kind']]: (task: Extract<MlTask, { kind: K }>) => Promise<MlResults[K]>
}

export interface MlTasks {
  run<T extends MlTask>(task: T): Promise<MlResults[T['kind']]>
}

/** The on-device models and document extractors the ML utility process serves. */
export function createMlTasks(cacheDir: string): MlTasks {
  const whisper = new IdleResource<Asr>({
    load: async () => {
      const { pipeline } = await loadTransformers(cacheDir)
      return (await pipeline('automatic-speech-recognition', WHISPER_MODEL)) as Asr
    },
    dispose: (asr) => asr.dispose(),
    idleMs: WHISPER_IDLE_MS
  })

  // First use downloads ~120 MB of quantized weights into the cache.
  const embedder = new IdleResource<Extractor>({
    load: async () => {
      const { pipeline } = await loadTransformers(cacheDir)
      return (await pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL, {
        revision: LOCAL_EMBEDDING_REVISION
      })) as Extractor
    },
    dispose: (extractor) => extractor.dispose(),
    idleMs: EMBEDDER_IDLE_MS
  })

  const parakeet = createParakeet(cacheDir)

  const loaders: Record<MlModel, () => Promise<void>> = {
    whisper: () => whisper.use(async () => {}),
    embedder: () => embedder.use(async () => {}),
    parakeet: async () => {
      await parakeet.load()
    }
  }

  const handlers: Handlers = {
    load: (task) => loaders[task.model](),
    transcribe: (task) =>
      whisper.use(async (asr) => {
        const r = await asr(task.samples, {
          language: task.language,
          task: 'transcribe',
          chunk_length_s: task.chunkSeconds
        })
        return (r.text ?? '').trim()
      }),
    speechFeed: (task) => parakeet.feed(task.stream, task.samples),
    speechEnd: (task) => parakeet.end(task.stream),
    embed: (task) => embedder.use((extractor) => embedTexts(extractor, task.texts)),
    extract: (task) => (task.format === 'pdf' ? extractPdf(task.data) : extractDocx(task.data))
  }

  return {
    run: (task) => (handlers[task.kind] as (task: MlTask) => Promise<never>)(task)
  }
}

async function embedTexts(extractor: Extractor, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (const text of texts) {
    const r = await extractor(text, { pooling: 'mean', normalize: true })
    // `r.data` is a backing tensor — clone so it can't be reused by the next
    // inference before the batch is sent.
    out.push(new Float32Array(r.data))
    // onnxruntime-node settles inferences on process.nextTick, which never lets
    // queued messages in; without this a long index flush would hold up every
    // Whisper batch behind it.
    await new Promise((resolve) => setImmediate(resolve))
  }
  return out
}

async function extractPdf(data: Uint8Array): Promise<string> {
  const { extractText } = await import('unpdf')
  // PDF.js rejects Node Buffers; it wants a plain Uint8Array.
  const out = await extractText(new Uint8Array(data), { mergePages: true })
  return out.text.trim()
}

async function extractDocx(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const out = await mammoth.extractRawText({ buffer })
  return out.value.trim()
}
