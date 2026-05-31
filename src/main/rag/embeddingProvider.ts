/** Model id baked into the vec schema meta — change forces a reindex. */
export const LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface IEmbeddingProvider {
  /** Output dimensionality. RAG schema is bound to this — keep stable. */
  readonly dim: number
  /** Stable model identifier — persisted in the vec meta for migration checks. */
  readonly model: string
  /** Embed a batch of strings. Result length === input length. */
  embed(texts: string[]): Promise<Float32Array[]>
}

let local: IEmbeddingProvider | null = null
let localPromise: Promise<IEmbeddingProvider | null> | null = null

/**
 * Lazy-init Xenova MiniLM-L6-v2 (384-dim, ONNX, on-device).
 * First call downloads ~22 MB of model weights into the user cache; subsequent
 * calls are instant. Returns null if the import fails (e.g. ONNX runtime not
 * available) so callers can degrade gracefully.
 */
export async function getLocalEmbedder(): Promise<IEmbeddingProvider | null> {
  if (local) return local
  if (localPromise) return localPromise
  localPromise = (async () => {
    try {
      const mod = await import('@xenova/transformers')
      const { pipeline } = mod as unknown as {
        pipeline: (
          task: string,
          model: string
        ) => Promise<
          (
            input: string | string[],
            opts: { pooling?: string; normalize?: boolean }
          ) => Promise<{ data: Float32Array; dims: number[] }>
        >
      }
      const extractor = await pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL)
      local = {
        dim: 384,
        model: LOCAL_EMBEDDING_MODEL,
        async embed(texts) {
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
      }
      return local
    } catch (err) {
      console.error('[rag] local embedder init failed', err)
      return null
    }
  })()
  return localPromise
}
