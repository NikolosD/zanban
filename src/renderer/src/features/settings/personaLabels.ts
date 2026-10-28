import type { TFunction } from 'i18next'
import { BUILTIN_PERSONAS } from '@shared/builtinPersonas'
import type { Persona } from '@shared/types'

function builtinOf(p: Persona): Persona | undefined {
  return p.builtin ? BUILTIN_PERSONAS.find((b) => b.id === p.id) : undefined
}

function labelKey(p: Persona): string {
  return `settings.personas.builtin.${p.id.slice('builtin:'.length)}`
}

/** A built-in role shows its translated name until the user renames it. */
export function personaName(p: Persona, t: TFunction): string {
  const builtin = builtinOf(p)
  return builtin && p.name === builtin.name ? t(`${labelKey(p)}.name`) : p.name
}

/** A translated one-liner for an untouched built-in role; otherwise the prompt itself. */
export function personaBlurb(p: Persona, t: TFunction): string {
  const builtin = builtinOf(p)
  return builtin && p.systemPrompt === builtin.systemPrompt
    ? t(`${labelKey(p)}.blurb`)
    : p.systemPrompt
}
