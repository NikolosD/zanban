import { IdleResource } from '../services/idleResource.js'
import { loadTransformers, type TransformersPipeline } from '../services/transformers.js'

/** Multilingual (50+ languages incl. Russian) sentence encoder, 384-dim, ONNX. */
export const LOCAL_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
// Pinned so an upstream re-export can't silently change the vectors already stored.
export const LOCAL_EMBEDDING_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
export const LOCAL_EMBEDDING_DIM = 384
/** Identity baked into the vec schema meta — a model or revision change forces a reindex. */
export const LOCAL_EMBEDDING_ID = `${LOCAL_EMBEDDING_MODEL}@${LOCAL_EMBEDDING_REVISION}`

// The loaded encoder holds ~700 MB, and RAG runs in bursts (an ask, an index
// flush), so it is dropped between them and reloaded from the disk cache.
const EMBEDDER_IDLE_MS = 5 * 60_000

export interface IEmbeddingProvider {
  /** Output dimensionality. RAG schema is bound to this — keep stable. */
  readonly dim: number
  /** Stable model identifier — persisted in the vec meta for migration checks. */
  readonly model: string
  /** Embed a batch of strings. Result length === input length. */
  embed(texts: string[]): Promise<Float32Array[]>
}

type Extractor = TransformersPipeline &
  ((
    input: string,
    opts: { pooling: 'mean'; normalize: boolean }
  ) => Promise<{ data: Float32Array }>)

/** First use downloads ~120 MB of quantized weights into userData/models. */
async function loadExtractor(): Promise<Extractor> {
  const { pipeline } = await loadTransformers()
  return (await pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL, {
    revision: LOCAL_EMBEDDING_REVISION
  })) as Extractor
}

async function embedWith(extractor: Extractor, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  // Run sequentially — the pipeline is single-threaded in this build.
  for (const text of texts) {
    const r = await extractor(text, { pooling: 'mean', normalize: true })
    // `r.data` is a backing tensor — clone so callers can hold it
    // without locking the next inference.
    out.push(new Float32Array(r.data))
  }
  return out
}

/** Load a standalone instance of the pinned local encoder. */
export async function loadEmbedder(): Promise<IEmbeddingProvider> {
  const extractor = await loadExtractor()
  return {
    dim: LOCAL_EMBEDDING_DIM,
    model: LOCAL_EMBEDDING_ID,
    embed: (texts) => embedWith(extractor, texts)
  }
}

const sharedExtractor = new IdleResource<Extractor>({
  load: loadExtractor,
  dispose: (extractor) => extractor.dispose(),
  idleMs: EMBEDDER_IDLE_MS
})

const localEmbedder: IEmbeddingProvider = {
  dim: LOCAL_EMBEDDING_DIM,
  model: LOCAL_EMBEDDING_ID,
  embed: (texts) => sharedExtractor.use((extractor) => embedWith(extractor, texts))
}

/**
 * Shared on-device embedder, or null when it can't load (ONNX runtime missing,
 * first-run download offline) so callers degrade gracefully. A failed load is
 * retried on the next call rather than disabling RAG until restart.
 */
export async function getLocalEmbedder(): Promise<IEmbeddingProvider | null> {
  try {
    await sharedExtractor.use(async () => {})
    return localEmbedder
  } catch (err) {
    console.error('[rag] local embedder init failed', err)
    return null
  }
}
