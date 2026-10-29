import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider } from '@shared/types'
import { servesModel } from '@shared/modelIds'

/**
 * A filter for model pickers: drops curated models that the provider's live
 * model list no longer has. Loads the lists of the given providers; a list
 * that isn't known (no key, offline, Ollama) leaves its models unchanged.
 */
export function useAvailableModels(
  ...providers: LlmProvider[]
): (provider: LlmProvider, models: string[]) => string[] {
  const [lists, setLists] = useState<Partial<Record<LlmProvider, string[]>>>({})
  const wanted = [...new Set(providers)].join(',')
  useEffect(() => {
    let alive = true
    for (const provider of wanted.split(',') as LlmProvider[]) {
      window.zanban.ai
        .availableModels(provider)
        .then((ids) => {
          if (alive && ids) setLists((prev) => ({ ...prev, [provider]: ids }))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [wanted])
  return useCallback(
    (provider, models) => {
      const ids = lists[provider]
      return ids ? models.filter((m) => servesModel(ids, m)) : models
    },
    [lists]
  )
}
