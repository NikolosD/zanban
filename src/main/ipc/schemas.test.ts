import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/types.js'
import { redactSettings } from '../../shared/settingsBoundary.js'
import {
  aiAskInputSchema,
  documentPathSchema,
  importedPersonaSchema,
  settingsPatchSchema
} from './schemas.js'

describe('settingsPatchSchema', () => {
  it('accepts a full settings object as the renderer holds it', () => {
    expect(settingsPatchSchema.safeParse(redactSettings(DEFAULT_SETTINGS)).success).toBe(true)
  })

  it('accepts partial patches and keeps absent keys absent', () => {
    const patch = settingsPatchSchema.parse({ detectable: true })
    expect(patch).toEqual({ detectable: true })
  })

  it('rejects unknown keys', () => {
    expect(settingsPatchSchema.safeParse({ anthropicApiKeyEnc: 'x' }).success).toBe(false)
  })

  it('rejects mistyped values', () => {
    expect(settingsPatchSchema.safeParse({ detectable: 'yes' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ contextSeconds: '30' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ overlayOpacity: 2 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ llmProvider: 'skynet' }).success).toBe(false)
  })

  it('only takes http(s) or empty Ollama hosts', () => {
    expect(settingsPatchSchema.safeParse({ ollamaHost: '' }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ ollamaHost: 'http://10.0.0.2:11434' }).success).toBe(
      true
    )
    expect(settingsPatchSchema.safeParse({ ollamaHost: 'file:///etc/passwd' }).success).toBe(false)
  })

  it('fills model slots missing from older stored entries', () => {
    const patch = settingsPatchSchema.parse({ aiModels: { anthropic: { fast: 'claude-x' } } })
    expect(patch.aiModels?.anthropic).toEqual({
      fast: 'claude-x',
      filter: '',
      summary: '',
      vision: ''
    })
  })
})

describe('the autoAnswer setting', () => {
  it('is off until the user turns it on, because every question it catches costs a request', () => {
    expect(DEFAULT_SETTINGS.autoAnswer).toBe(false)
  })

  it('is settable from the overlay as a boolean patch', () => {
    expect(settingsPatchSchema.parse({ autoAnswer: true })).toEqual({ autoAnswer: true })
    expect(settingsPatchSchema.safeParse({ autoAnswer: 'on' }).success).toBe(false)
  })
})

describe('aiAskInputSchema', () => {
  it('accepts image data URLs only', () => {
    const base = { requestId: 'r1', prompt: 'hi' }
    expect(
      aiAskInputSchema.safeParse({ ...base, imageDataUrl: 'data:image/png;base64,AA' }).success
    ).toBe(true)
    expect(
      aiAskInputSchema.safeParse({ ...base, imageDataUrl: 'file:///etc/passwd' }).success
    ).toBe(false)
    expect(
      aiAskInputSchema.safeParse({ ...base, imageDataUrl: 'data:text/html,<b>' }).success
    ).toBe(false)
  })

  it('passes skipRetrieval through instead of stripping it', () => {
    const base = { requestId: 'r1', prompt: 'hi' }
    expect(aiAskInputSchema.parse({ ...base, skipRetrieval: true }).skipRetrieval).toBe(true)
    expect(aiAskInputSchema.parse(base).skipRetrieval).toBeUndefined()
    expect(aiAskInputSchema.safeParse({ ...base, skipRetrieval: 'yes' }).success).toBe(false)
  })
})

describe('documentPathSchema', () => {
  it('accepts absolute paths with a supported extension', () => {
    expect(documentPathSchema.safeParse('/docs/Notes.PDF').success).toBe(true)
  })

  it('rejects other extensions and relative paths', () => {
    expect(documentPathSchema.safeParse('/docs/run.exe').success).toBe(false)
    expect(documentPathSchema.safeParse('/docs/noext').success).toBe(false)
    expect(documentPathSchema.safeParse('docs/notes.md').success).toBe(false)
  })
})

describe('importedPersonaSchema', () => {
  it('keeps typed optional fields and drops unknown ones', () => {
    const parsed = importedPersonaSchema.parse({
      id: 'custom:1',
      name: 'Coach',
      systemPrompt: 'Be brief.',
      responseLanguage: 'en',
      ragStrategy: { useRag: true, topK: 4, distanceThreshold: 1.1 },
      builtin: true
    })
    expect(parsed).not.toHaveProperty('builtin')
    expect(parsed.ragStrategy?.topK).toBe(4)
  })

  it('rejects mistyped optional fields', () => {
    const base = { name: 'Coach', systemPrompt: 'Be brief.' }
    expect(importedPersonaSchema.safeParse({ ...base, responseLanguage: 'klingon' }).success).toBe(
      false
    )
    expect(importedPersonaSchema.safeParse({ ...base, ragStrategy: 'lots' }).success).toBe(false)
    expect(importedPersonaSchema.safeParse({ ...base, defaultModel: 42 }).success).toBe(false)
  })
})
