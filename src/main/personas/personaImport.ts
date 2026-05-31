import { randomUUID } from 'node:crypto'
import type { Persona } from '../../shared/types.js'

/**
 * Pure import mapper — turns parsed JSON into validated Persona records,
 * deduping ids against `existingIds` and skipping malformed entries. Kept free
 * of electron-store so the mapping (which fields survive a round-trip) can be
 * unit-tested in the node test environment. `makeId` is injected so tests can
 * use a deterministic generator.
 */
export function parseImportedPersonas(
  data: unknown,
  existingIds: Set<string>,
  makeId: () => string = () => `custom:${randomUUID()}`
): { personas: Persona[]; added: number; skipped: number } {
  if (!Array.isArray(data)) throw new Error('Expected an array of personas')
  const personas: Persona[] = []
  let added = 0
  let skipped = 0
  const seen = new Set(existingIds)
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') {
      skipped++
      continue
    }
    const p = raw as Persona
    if (typeof p.name !== 'string' || typeof p.systemPrompt !== 'string') {
      skipped++
      continue
    }
    const id = seen.has(p.id) || !p.id ? makeId() : p.id
    personas.push({
      id,
      name: p.name,
      systemPrompt: p.systemPrompt,
      defaultModel: p.defaultModel,
      responseLanguage: p.responseLanguage,
      // Preserve RAG tuning on reimport — dropping it silently reset useRag /
      // topK / distanceThreshold to defaults, losing the user's persona config.
      ragStrategy: p.ragStrategy,
      builtin: false,
      createdAt: Date.now()
    })
    seen.add(id)
    added++
  }
  return { personas, added, skipped }
}
