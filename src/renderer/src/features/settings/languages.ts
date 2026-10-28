import type { AppSettings, ResponseLanguage } from '@shared/types'

export type RecapLanguage = AppSettings['recap']['language']

type LanguageSettings = Pick<AppSettings, 'recap' | 'responseLanguage'>

/**
 * Recap language that tracks an answer language. Recaps are only written in
 * English or Russian; for any other answer language they match the
 * conversation, as auto answers do.
 */
export function recapLanguageFor(answers: ResponseLanguage): RecapLanguage {
  return answers === 'en' || answers === 'ru' ? answers : 'auto'
}

/**
 * "Same as answers" isn't stored: a recap counts as following the answers
 * while its language equals the one derived from the answer language.
 */
export function recapFollowsAnswers(settings: LanguageSettings): boolean {
  return settings.recap.language === recapLanguageFor(settings.responseLanguage)
}

/** Recap settings after the answer language changes; a following recap keeps following. */
export function recapAfterAnswersChange(
  settings: LanguageSettings,
  answers: ResponseLanguage
): AppSettings['recap'] {
  if (!recapFollowsAnswers(settings)) return settings.recap
  const language = recapLanguageFor(answers)
  return language === settings.recap.language ? settings.recap : { ...settings.recap, language }
}
