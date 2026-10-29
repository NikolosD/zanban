import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { matchPreset, presetPatch, SETUP_PRESETS } from './presets'

const preset = (id: string) => SETUP_PRESETS.find((p) => p.id === id)!
const apply = (settings: AppSettings, id: string): AppSettings => ({
  ...settings,
  ...presetPatch(preset(id), settings)
})

describe('setup presets', () => {
  it('a fresh install already matches the recommended setup', () => {
    expect(matchPreset(DEFAULT_SETTINGS)).toBe('recommended')
  })

  it('applying a preset makes the settings match it, and switching back clears its models', () => {
    const quality = apply(DEFAULT_SETTINGS, 'quality')
    expect(matchPreset(quality)).toBe('quality')
    expect(quality.aiModels['vercel-gateway']?.fast).toBe('openai/gpt-6.1-terra')

    const back = apply(quality, 'recommended')
    expect(matchPreset(back)).toBe('recommended')
    expect(back.aiModels['vercel-gateway']).toBeUndefined()
  })

  it('the private preset turns privacy mode on', () => {
    const priv = apply(DEFAULT_SETTINGS, 'private')
    expect(matchPreset(priv)).toBe('private')
    expect(priv.privacyMode).toBe(true)
  })

  it('a hand-made setup matches no preset', () => {
    expect(matchPreset({ ...DEFAULT_SETTINGS, llmProvider: 'anthropic' })).toBeNull()
  })
})
