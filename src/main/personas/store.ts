import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { Persona } from '../../shared/types.js'
import { BUILTIN_PERSONAS } from './builtins.js'

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
  if (!Array.isArray(data)) throw new Error('Expected an array of personas')
  let added = 0
  let skipped = 0
  const existing = new Set(listPersonas().map((p) => p.id))
  const next = listPersonas()
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
    const id = existing.has(p.id) ? `custom:${randomUUID()}` : p.id || `custom:${randomUUID()}`
    next.push({
      id,
      name: p.name,
      systemPrompt: p.systemPrompt,
      defaultModel: p.defaultModel,
      responseLanguage: p.responseLanguage,
      builtin: false,
      createdAt: Date.now()
    })
    existing.add(id)
    added++
  }
  store.set('personas', next)
  return { added, skipped }
}

export function exportPersonas(ids?: string[]): string {
  const all = listPersonas()
  const subset = ids ? all.filter((p) => ids.includes(p.id)) : all
  return JSON.stringify(subset, null, 2)
}
