import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { Persona } from '../../shared/types.js'
import { BUILTIN_PERSONAS } from './builtins.js'
import { parseImportedPersonas } from './personaImport.js'

interface PersistedShape {
  personas: Persona[]
  /** Once-only flag: builtins were copied into the user store. Lets the user
   * delete a builtin and not have it re-appear next launch. */
  builtinsSeeded: boolean
}

const store = new Store<PersistedShape>({
  name: 'personas',
  defaults: { personas: [], builtinsSeeded: false }
})

function ensureSeeded(): void {
  if (store.store.builtinsSeeded) return
  const now = Date.now()
  store.set(
    'personas',
    BUILTIN_PERSONAS.map((p) => ({ ...p, createdAt: now }))
  )
  store.set('builtinsSeeded', true)
}

export function listPersonas(): Persona[] {
  ensureSeeded()
  return (store.store.personas ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
}

export function getPersona(id: string): Persona | null {
  return listPersonas().find((p) => p.id === id) ?? null
}

export function createPersona(input: Omit<Persona, 'id' | 'builtin' | 'createdAt'>): Persona {
  ensureSeeded()
  const persona: Persona = {
    id: `custom:${randomUUID()}`,
    name: input.name.trim() || 'Untitled persona',
    systemPrompt: input.systemPrompt,
    defaultModel: input.defaultModel,
    responseLanguage: input.responseLanguage,
    builtin: false,
    createdAt: Date.now()
  }
  store.set('personas', [...listPersonas(), persona])
  return persona
}

export function updatePersona(id: string, patch: Partial<Persona>): Persona | null {
  const list = listPersonas()
  const i = list.findIndex((p) => p.id === id)
  if (i < 0) return null
  const next: Persona = {
    ...list[i]!,
    ...patch,
    id: list[i]!.id,
    createdAt: list[i]!.createdAt
  }
  list[i] = next
  store.set('personas', list)
  return next
}

export function deletePersona(id: string): boolean {
  const before = listPersonas()
  const after = before.filter((p) => p.id !== id)
  if (after.length === before.length) return false
  store.set('personas', after)
  return true
}

export function importPersonas(json: string): { added: number; skipped: number } {
  const data = JSON.parse(json) as unknown
  const current = listPersonas()
  const existing = new Set(current.map((p) => p.id))
  const { personas, added, skipped } = parseImportedPersonas(data, existing)
  store.set('personas', [...current, ...personas])
  return { added, skipped }
}

export function exportPersonas(ids?: string[]): string {
  const all = listPersonas()
  const subset = ids ? all.filter((p) => ids.includes(p.id)) : all
  return JSON.stringify(subset, null, 2)
}
