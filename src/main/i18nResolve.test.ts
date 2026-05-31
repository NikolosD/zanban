import { describe, it, expect } from 'vitest'
import { resolveTranslation, type Locale } from './i18nResolve'

const RES: Record<Locale, unknown> = {
  en: {
    tray: { start_session: 'Start session' },
    updates: { available_body: 'Version {{version}} has been downloaded.' },
    only_en: 'English only'
  },
  ru: {
    tray: { start_session: 'Начать сессию' }
    // intentionally missing `updates` + `only_en` to exercise the EN fallback
  }
}

describe('resolveTranslation', () => {
  it('resolves a nested key for the requested locale', () => {
    expect(resolveTranslation(RES, 'ru', 'tray.start_session')).toBe('Начать сессию')
    expect(resolveTranslation(RES, 'en', 'tray.start_session')).toBe('Start session')
  })

  it('interpolates {{vars}}', () => {
    expect(resolveTranslation(RES, 'en', 'updates.available_body', { version: '1.2.3' })).toBe(
      'Version 1.2.3 has been downloaded.'
    )
  })

  it('falls back to English when the locale lacks the key', () => {
    expect(resolveTranslation(RES, 'ru', 'updates.available_body', { version: '9' })).toBe(
      'Version 9 has been downloaded.'
    )
    expect(resolveTranslation(RES, 'ru', 'only_en')).toBe('English only')
  })

  it('returns the raw key when it is missing entirely', () => {
    expect(resolveTranslation(RES, 'en', 'nope.not.here')).toBe('nope.not.here')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(resolveTranslation(RES, 'en', 'updates.available_body')).toBe(
      'Version {{version}} has been downloaded.'
    )
  })

  it('does not resolve a key that points at an object (non-string leaf)', () => {
    expect(resolveTranslation(RES, 'en', 'tray')).toBe('tray')
  })
})
