import type { LlmProvider } from '../../shared/types.js'
import { getSettings } from '../settings.js'
import { getLlmProviderById } from '../providers/registry.js'
import { catalogLanguageModels, refreshGatewayCatalog } from './gatewayCatalog.js'

const TTL_MS = 6 * 60 * 60_000
// A list that failed to load (offline, a key without the right to read it) is
// left unknown for a while instead of being asked for again on every answer.
const RETRY_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000

interface Listed {
  key: string
  ids: string[] | null
  expires: number
}

const listed = new Map<LlmProvider, Listed>()
const inflight = new Map<LlmProvider, Promise<void>>()

function savedKey(id: LlmProvider): string | null {
  const s = getSettings()
  const keys: Partial<Record<LlmProvider, string | null>> = {
    anthropic: s.anthropicApiKey,
    openai: s.openaiApiKey,
    groq: s.groqApiKey,
    'google-gemini': s.googleAiApiKey
  }
  return keys[id] ?? null
}

/**
 * Load which models a provider serves, from its own model list: the gateway's
 * public catalog, or the list a direct provider returns for the saved key.
 * Cached per key, so a new key in Settings gets its own list.
 */
export function refreshModels(id: LlmProvider): Promise<void> {
  if (id === 'vercel-gateway') return refreshGatewayCatalog()
  const key = savedKey(id)
  const entry = listed.get(id)
  if (!key || (entry?.key === key && Date.now() < entry.expires)) return Promise.resolve()
  const running = inflight.get(id)
  if (running) return running
  const load = (async () => {
    try {
      const ids = await getLlmProviderById(id)?.listModels?.(AbortSignal.timeout(FETCH_TIMEOUT_MS))
      // An empty list would hide every model, so it counts as unknown.
      listed.set(id, { key, ids: ids?.length ? ids : null, expires: Date.now() + TTL_MS })
    } catch (err) {
      console.warn(`[ai] ${id} model list unavailable`, err)
      listed.set(id, { key, ids: null, expires: Date.now() + RETRY_MS })
    } finally {
      inflight.delete(id)
    }
  })()
  inflight.set(id, load)
  return load
}

/** Model ids the provider serves, or null while unknown (not loaded, no list). */
export function modelIds(id: LlmProvider): string[] | null {
  if (id === 'vercel-gateway') return catalogLanguageModels()?.map((m) => m.id) ?? null
  const entry = listed.get(id)
  return entry && entry.key === savedKey(id) ? entry.ids : null
}

/** Test seam: forget every loaded list. */
export function resetModelListsForTest(): void {
  listed.clear()
  inflight.clear()
}
