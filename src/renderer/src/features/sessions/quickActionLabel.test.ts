import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'
import { quickActionLabel } from './quickActionLabel'

const t = ((key: string) => `t:${key}`) as unknown as TFunction

describe('quickActionLabel', () => {
  it('names the quick action instead of showing its instruction', () => {
    expect(quickActionLabel(ANSWER_LAST_PROMPT, t)).toBe('t:overlay.labels.answer_last')
  })

  it('treats an empty prompt as the snap-and-answer hotkey', () => {
    expect(quickActionLabel('', t)).toBe('t:overlay.labels.screenshot_answer')
  })

  it('leaves a typed question alone', () => {
    expect(quickActionLabel('Какой бюджет?', t)).toBeNull()
  })
})
