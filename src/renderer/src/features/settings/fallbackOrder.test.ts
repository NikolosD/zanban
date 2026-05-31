import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { autoFallbackOrder, providerHasKey } from './fallbackOrder'

function settings(patch: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...patch }
}

describe('providerHasKey', () => {
  it('reports cloud providers configured only when their key is set', () => {
    const s = settings({ anthropicApiKey: 'sk-ant', openaiApiKey: null })
    expect(providerHasKey('anthropic', s)).toBe(true)
    expect(providerHasKey('openai', s)).toBe(false)
  })

  it('treats ollama as always configured (no key needed)', () => {
    expect(providerHasKey('ollama', settings({}))).toBe(true)
  })

  it('keys vercel-gateway off vercelApiKey', () => {
    expect(providerHasKey('vercel-gateway', settings({ vercelApiKey: 'vck_1' }))).toBe(true)
    expect(providerHasKey('vercel-gateway', settings({ vercelApiKey: null }))).toBe(false)
  })
})

describe('autoFallbackOrder', () => {
  it('includes only providers with a key, in preference order, minus the active one', () => {
    const s = settings({
      llmProvider: 'anthropic',
      anthropicApiKey: 'sk-ant',
      openaiApiKey: 'sk-oa',
      vercelApiKey: 'vck',
      googleAiApiKey: null,
      groqApiKey: null
    })
    // vercel (has key) > anthropic (active, excluded) > openai (has key) >
    // gemini/groq (no key) > ollama (always). Expected: vercel, openai, ollama.
    expect(autoFallbackOrder(s)).toEqual(['vercel-gateway', 'openai', 'ollama'])
  })

  it('excludes the active provider even when it has a key', () => {
    const s = settings({ llmProvider: 'openai', openaiApiKey: 'sk-oa' })
    expect(autoFallbackOrder(s)).not.toContain('openai')
  })

  it('always offers ollama as a tail candidate', () => {
    const s = settings({ llmProvider: 'vercel-gateway', vercelApiKey: 'vck' })
    const order = autoFallbackOrder(s)
    expect(order[order.length - 1]).toBe('ollama')
  })

  it('returns just ollama when no cloud keys are set', () => {
    const s = settings({ llmProvider: 'anthropic' })
    expect(autoFallbackOrder(s)).toEqual(['ollama'])
  })
})
