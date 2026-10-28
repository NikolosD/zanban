import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { BUILTIN_PERSONAS } from '@shared/builtinPersonas'
import type { Persona } from '@shared/types'
import { personaBlurb, personaName } from './personaLabels'

const t = ((key: string) => `t:${key}`) as unknown as TFunction
const interview = BUILTIN_PERSONAS.find((p) => p.id === 'builtin:tech-interview')!

describe('persona labels', () => {
  it('translates a built-in role the user has not touched', () => {
    expect(personaName(interview, t)).toBe('t:settings.personas.builtin.tech-interview.name')
    expect(personaBlurb(interview, t)).toBe('t:settings.personas.builtin.tech-interview.blurb')
  })

  it("keeps the user's own name and prompt for an edited built-in", () => {
    const edited = { ...interview, name: 'Собес в Яндекс', systemPrompt: 'Мой промпт' }
    expect(personaName(edited, t)).toBe('Собес в Яндекс')
    expect(personaBlurb(edited, t)).toBe('Мой промпт')
  })

  it('shows a custom role as written', () => {
    const custom: Persona = {
      id: 'p1',
      name: 'General assistant',
      systemPrompt: 'Custom',
      builtin: false,
      createdAt: 0
    }
    expect(personaName(custom, t)).toBe('General assistant')
    expect(personaBlurb(custom, t)).toBe('Custom')
  })
})
