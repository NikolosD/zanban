import { describe, expect, it } from 'vitest'
import {
  isRedactedSecret,
  isValidOllamaHost,
  REDACTED_SECRET_PREFIX,
  redactedSecretMask,
  redactSecret,
  redactSettings,
  SECRET_SETTING_KEYS
} from './settingsBoundary.js'
import { DEFAULT_SETTINGS, type AppSettings } from './types.js'

describe('redactSecret', () => {
  it('keeps only the last four characters of a token', () => {
    const marker = redactSecret('sk-ant-api03-abcdefgh1234')
    expect(marker).toBe(`${REDACTED_SECRET_PREFIX}1234`)
    expect(isRedactedSecret(marker)).toBe(true)
    expect(redactedSecretMask(marker!)).toBe('••••1234')
  })

  it('returns null when no secret is set', () => {
    expect(redactSecret(null)).toBeNull()
    expect(redactSecret('')).toBeNull()
  })

  it('drops the tail for short values and non-token endings', () => {
    expect(redactSecret('abc12345')).toBe(REDACTED_SECRET_PREFIX)
    expect(redactSecret('{\n  "type": "service_account"\n}')).toBe(REDACTED_SECRET_PREFIX)
    expect(redactedSecretMask(REDACTED_SECRET_PREFIX)).toBe('••••')
  })

  it('does not mistake a real key for a marker', () => {
    expect(isRedactedSecret('sk-ant-api03-abcdefgh1234')).toBe(false)
    expect(isRedactedSecret(null)).toBe(false)
  })
})

describe('redactSettings', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    anthropicApiKey: 'sk-ant-api03-abcdefgh1234',
    googleServiceAccountJson: '{"private_key":"-----BEGIN PRIVATE KEY-----"}',
    contextSeconds: 42,
    anthropicApiKeyEnc: 'ciphertext',
    hideDockMacOS: true
  } as AppSettings

  it('never lets a secret through in clear', () => {
    const out = redactSettings(settings)
    for (const key of SECRET_SETTING_KEYS) {
      const value = out[key]
      expect(value === null || isRedactedSecret(value)).toBe(true)
    }
    expect(JSON.stringify(out)).not.toContain('abcdefgh')
    expect(JSON.stringify(out)).not.toContain('PRIVATE KEY')
  })

  it('keeps presence checks truthy and other fields intact', () => {
    const out = redactSettings(settings)
    expect(!!out.anthropicApiKey).toBe(true)
    expect(out.openaiApiKey).toBeNull()
    expect(out.contextSeconds).toBe(42)
    expect(out.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys)
  })

  it('drops fields that are not part of AppSettings', () => {
    const out = redactSettings(settings) as unknown as Record<string, unknown>
    expect(out).not.toHaveProperty('anthropicApiKeyEnc')
    expect(out).not.toHaveProperty('hideDockMacOS')
  })
})

describe('isValidOllamaHost', () => {
  it('accepts empty and http(s) URLs', () => {
    expect(isValidOllamaHost('')).toBe(true)
    expect(isValidOllamaHost('http://127.0.0.1:11434')).toBe(true)
    expect(isValidOllamaHost('https://ollama.lan')).toBe(true)
  })

  it('rejects other schemes and garbage', () => {
    expect(isValidOllamaHost('file:///etc/passwd')).toBe(false)
    expect(isValidOllamaHost('javascript:alert(1)')).toBe(false)
    expect(isValidOllamaHost('localhost:11434')).toBe(false)
    expect(isValidOllamaHost('not a url')).toBe(false)
  })
})
