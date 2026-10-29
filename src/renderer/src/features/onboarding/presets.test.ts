import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, PROVIDER_MODEL_DEFAULTS, type AppSettings } from '@shared/types'
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

  it('applying a preset makes the settings match it and clears hand-picked gateway models', () => {
    const custom: AppSettings = {
      ...DEFAULT_SETTINGS,
      aiModels: {
        'vercel-gateway': {
          ...PROVIDER_MODEL_DEFAULTS['vercel-gateway'],
          fast: 'openai/gpt-oss-120b'
        }
      }
    }
    expect(matchPreset(custom)).toBeNull()

    const quality = apply(custom, 'quality')
    expect(matchPreset(quality)).toBe('quality')
    expect(quality.sttProvider).toBe('elevenlabs')
    expect(quality.aiModels['vercel-gateway']).toBeUndefined()
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
