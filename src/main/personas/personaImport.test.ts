import { describe, it, expect } from 'vitest'
import { parseImportedPersonas } from './personaImport.js'
import type { Persona } from '../../shared/types.js'

const baseRag = { useRag: false, topK: 12, distanceThreshold: 0.8 }

function counter(): () => string {
  let n = 0
  return () => `gen:${n++}`
}

describe('parseImportedPersonas', () => {
  it('preserves ragStrategy / defaultModel / responseLanguage on reimport', () => {
    const exported: Partial<Persona>[] = [
      {
        id: 'custom:abc',
        name: 'Analyst',
        systemPrompt: 'Be precise.',
        defaultModel: 'claude-haiku-4-5',
        responseLanguage: 'ru',
        ragStrategy: baseRag,
        builtin: false
      }
    ]
    const { personas, added, skipped } = parseImportedPersonas(exported, new Set(), counter())
    expect(added).toBe(1)
    expect(skipped).toBe(0)
    expect(personas[0]).toMatchObject({
      name: 'Analyst',
      defaultModel: 'claude-haiku-4-5',
      responseLanguage: 'ru',
      ragStrategy: baseRag,
      builtin: false
    })
  })

  it('reassigns a fresh id when the imported id collides with an existing one', () => {
    const data = [{ id: 'custom:dup', name: 'A', systemPrompt: 'x', ragStrategy: baseRag }]
    const { personas } = parseImportedPersonas(data, new Set(['custom:dup']), counter())
    expect(personas[0]!.id).toBe('gen:0')
    // ragStrategy still survives the id reassignment path.
    expect(personas[0]!.ragStrategy).toEqual(baseRag)
  })

  it('keeps the original id when it does not collide', () => {
    const data = [{ id: 'custom:keep', name: 'A', systemPrompt: 'x' }]
    const { personas } = parseImportedPersonas(data, new Set(), counter())
    expect(personas[0]!.id).toBe('custom:keep')
  })

  it('skips malformed entries (missing name/prompt or non-objects)', () => {
    const data = [
      null,
      'not an object',
      { name: 'no prompt' },
      { systemPrompt: 'no name' },
      { name: 'ok', systemPrompt: 'ok' }
    ]
    const { added, skipped } = parseImportedPersonas(data, new Set(), counter())
    expect(added).toBe(1)
    expect(skipped).toBe(4)
  })

  it('always marks imported personas as non-builtin', () => {
    const data = [{ id: 'x', name: 'A', systemPrompt: 'x', builtin: true }]
    const { personas } = parseImportedPersonas(data, new Set(), counter())
    expect(personas[0]!.builtin).toBe(false)
  })

  it('throws when the payload is not an array', () => {
    expect(() => parseImportedPersonas({ not: 'array' }, new Set())).toThrow(
      'Expected an array of personas'
    )
  })
})
