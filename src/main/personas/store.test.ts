import { describe, expect, it, vi } from 'vitest'
import type { Persona } from '../../shared/types.js'

const data = vi.hoisted(() => ({ personas: [] as Persona[], builtinsSeeded: true }))

vi.mock('electron-store', () => ({
  default: class {
    get store(): typeof data {
      return data
    }
    set(key: keyof typeof data, value: never): void {
      data[key] = value
    }
  }
}))

const { listPersonas } = await import('./store.js')

const persona = (id: string, name: string, builtin = false): Persona => ({
  id,
  name,
  systemPrompt: '',
  builtin,
  createdAt: 0
})

describe('listPersonas', () => {
  it("puts the user's roles first by name, then built-ins in their curated order", () => {
    data.personas = [
      persona('builtin:lecture', 'Lecture · note-taking', true),
      persona('mine-b', 'Zeta'),
      persona('builtin:tech-interview', 'Technical interview · candidate', true),
      persona('builtin:general', 'General assistant', true),
      persona('mine-a', 'Alpha')
    ]
    expect(listPersonas().map((p) => p.id)).toEqual([
      'mine-a',
      'mine-b',
      'builtin:general',
      'builtin:tech-interview',
      'builtin:lecture'
    ])
  })
})
