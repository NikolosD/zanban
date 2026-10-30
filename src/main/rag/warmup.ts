import { getPersona } from '../personas/store.js'
import { getSettings } from '../settings.js'
import { sessionManager } from '../transcription/sessionManager.js'
import { getLocalEmbedder } from './embeddingProvider.js'
import { hasChunks } from './vectorStore.js'

// The ML worker unloads the embedder after 5 idle minutes; a ping just under
// that keeps a quiet stretch of a call from leaving the next question a cold load.
const KEEP_WARM_MS = 4 * 60_000

let keepWarmTimer: NodeJS.Timeout | null = null

// An empty store is skipped: the first chunk is only written after the live
// indexer has loaded the embedder, so a question can't need it any sooner.
async function warmUp(): Promise<void> {
  try {
    const { activePersonaId } = getSettings()
    if (activePersonaId && getPersona(activePersonaId)?.ragStrategy?.useRag === false) return
    if (!(await hasChunks())) return
    if (!(await getLocalEmbedder())) {
      console.warn('[rag] embedder warm-up failed; it loads on the first question instead')
    }
  } catch (err) {
    console.warn('[rag] embedder warm-up failed', err)
  }
}

/**
 * Loads the embedder in the background each time a session starts, so the first
 * question that searches past meetings and documents doesn't wait on a cold
 * load, and pings it until the session stops so it stays loaded. The work runs
 * on a later turn of the event loop and can't throw into the session start.
 */
export function registerRagWarmup(): void {
  sessionManager.onState((state) => {
    if (keepWarmTimer) clearInterval(keepWarmTimer)
    keepWarmTimer = null
    if (state.kind !== 'running') return
    setImmediate(() => void warmUp())
    keepWarmTimer = setInterval(() => void warmUp(), KEEP_WARM_MS)
  })
}
