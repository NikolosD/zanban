import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ResponseLanguage } from '@shared/types'
import {
  recapAfterAnswersChange,
  recapFollowsAnswers,
  recapLanguageFor,
  type RecapLanguage
} from './languages'

function langs(answers: ResponseLanguage, recap: RecapLanguage) {
  return {
    responseLanguage: answers,
    recap: { ...DEFAULT_SETTINGS.recap, language: recap }
  }
}

describe('recapLanguageFor', () => {
  it('passes through the languages recaps support', () => {
    expect(recapLanguageFor('en')).toBe('en')
    expect(recapLanguageFor('ru')).toBe('ru')
  })

  it('falls back to the conversation language for the rest', () => {
    expect(recapLanguageFor('auto')).toBe('auto')
    expect(recapLanguageFor('de')).toBe('auto')
  })
})

describe('recapFollowsAnswers', () => {
  it('is true for the defaults', () => {
    expect(recapFollowsAnswers(DEFAULT_SETTINGS)).toBe(true)
  })

  it('is false once the recap is pinned to a different language', () => {
    expect(recapFollowsAnswers(langs('ru', 'en'))).toBe(false)
  })
})

describe('recapAfterAnswersChange', () => {
  it('moves a following recap to the new answer language', () => {
    expect(recapAfterAnswersChange(langs('auto', 'auto'), 'ru').language).toBe('ru')
  })

  it('leaves a pinned recap alone', () => {
    const settings = langs('ru', 'en')
    expect(recapAfterAnswersChange(settings, 'auto')).toBe(settings.recap)
  })

  it('returns the same object when nothing changes', () => {
    const settings = langs('auto', 'auto')
    expect(recapAfterAnswersChange(settings, 'de')).toBe(settings.recap)
  })
})
