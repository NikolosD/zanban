import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider } from '@shared/types'

let catalog: Promise<Set<string> | null> | null = null

function loadCatalog(): Promise<Set<string> | null> {
  catalog ??= window.zanban.ai
    .gatewayModels()
    .then((ids) => {
      // Not loaded yet (offline, first launch): ask again next time.
      if (!ids) catalog = null
      return ids ? new Set(ids) : null
    })
    .catch(() => {
      catalog = null
      return null
    })
  return catalog
}

/**
 * A filter for model pickers: drops curated gateway models the live catalog no
 * longer lists. Other providers' lists, and every list before the catalog
 * loads, pass through unchanged.
 */
export function useAvailableModels(): (provider: LlmProvider, models: string[]) => string[] {
  const [ids, setIds] = useState<Set<string> | null>(null)
  useEffect(() => {
    let alive = true
    void loadCatalog().then((loaded) => {
      if (alive) setIds(loaded)
    })
    return () => {
      alive = false
    }
  }, [])
  return useCallback(
    (provider, models) =>
      provider === 'vercel-gateway' && ids ? models.filter((m) => ids.has(m)) : models,
    [ids]
  )
}
