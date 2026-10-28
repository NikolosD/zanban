import type { TFunction } from 'i18next'
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '@shared/prompts'

const LABEL_KEYS = new Map([
  [ANSWER_LAST_PROMPT, 'overlay.labels.answer_last'],
  [SCREENSHOT_DEFAULT_PROMPT, 'overlay.labels.screenshot_answer'],
  [FOLLOW_UP_PROMPT, 'overlay.chips.follow_up'],
  [RECAP_PROMPT, 'overlay.chips.catch_up'],
  [WHAT_TO_ANSWER_PROMPT, 'overlay.chips.which_question'],
  [SHORTEN_PROMPT, 'overlay.chips.shorten']
])

/**
 * Quick actions send the model an instruction; a saved session shows the button
 * that was pressed instead. Null for a question the user typed. An empty prompt
 * is the snap-and-answer hotkey, which sends only the screenshot.
 */
export function quickActionLabel(prompt: string, t: TFunction): string | null {
  const trimmed = prompt.trim()
  if (!trimmed) return t('overlay.labels.screenshot_answer')
  const key = LABEL_KEYS.get(trimmed)
  return key ? t(key) : null
}
