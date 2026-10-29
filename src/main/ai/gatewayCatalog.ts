const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models'
const TTL_MS = 6 * 60 * 60_000
const FETCH_TIMEOUT_MS = 10_000

export interface CatalogModel {
  id: string
  type?: string
  /** false when the model rejects any temperature but its default. */
  temperature?: boolean
  reasoning_options?: Array<{ type: string; values?: string[] }>
  modalities?: { input?: string[] }
}

let cached: { at: number; byId: Map<string, CatalogModel> } | null = null
let inflight: Promise<void> | null = null

/**
 * The gateway's public model list (no key needed): which models exist, which
 * take a temperature, which reasoning levels they accept. Fetched in the
 * background; callers read whatever is cached and fall back without it.
 */
export function refreshGatewayCatalog(): Promise<void> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve()
  inflight ??= (async () => {
    try {
      const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { data: CatalogModel[] }
      cached = { at: Date.now(), byId: new Map(body.data.map((m) => [m.id, m])) }
    } catch (err) {
      console.warn('[gateway] model catalog unavailable', err)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function catalogModel(id: string): CatalogModel | undefined {
  return cached?.byId.get(id)
}

/** Language models in the catalog, or null before it has loaded. */
export function catalogLanguageModels(): CatalogModel[] | null {
  if (!cached) return null
  return [...cached.byId.values()].filter((m) => m.type === 'language')
}

/** Test seam: replace the cached catalog. */
export function setGatewayCatalogForTest(models: CatalogModel[] | null): void {
  cached = models ? { at: Date.now(), byId: new Map(models.map((m) => [m.id, m])) } : null
}
