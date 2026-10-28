import { mlWorker } from '../ml/index.js'
import { LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_REVISION } from '../ml/models.js'

export const LOCAL_EMBEDDING_DIM = 384
/** Identity baked into the vec schema meta — a model or revision change forces a reindex. */
export const LOCAL_EMBEDDING_ID = `${LOCAL_EMBEDDING_MODEL}@${LOCAL_EMBEDDING_REVISION}`

// The first load downloads ~120 MB of quantized weights into userData/models.
const LOAD_TIMEOUT_MS = 10 * 60_000
// A text embeds in 10–16 ms, and a document is embedded in one batch; scale the
// limit with the batch so only a wedged worker trips it.
const EMBED_TIMEOUT_BASE_MS = 60_000
const EMBED_TIMEOUT_PER_TEXT_MS = 200

export interface IEmbeddingProvider {
  /** Output dimensionality. RAG schema is bound to this — keep stable. */
  readonly dim: number
  /** Stable model identifier — persisted in the vec meta for migration checks. */
  readonly model: string
  /** Embed a batch of strings. Result length === input length. */
  embed(texts: string[]): Promise<Float32Array[]>
}

const localEmbedder: IEmbeddingProvider = {
  dim: LOCAL_EMBEDDING_DIM,
  model: LOCAL_EMBEDDING_ID,
  embed: (texts) =>
    mlWorker.request(
      { kind: 'embed', texts },
      EMBED_TIMEOUT_BASE_MS + texts.length * EMBED_TIMEOUT_PER_TEXT_MS
    )
}

/**
 * Shared on-device embedder, or null when it can't load (ONNX runtime missing,
 * first-run download offline) so callers degrade gracefully. A failed load is
 * retried on the next call rather than disabling RAG until restart.
 */
export async function getLocalEmbedder(): Promise<IEmbeddingProvider | null> {
  try {
    await mlWorker.request({ kind: 'load', model: 'embedder' }, LOAD_TIMEOUT_MS)
    return localEmbedder
  } catch (err) {
    console.error('[rag] local embedder init failed', err)
    return null
  }
}
