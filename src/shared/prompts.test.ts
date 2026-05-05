import { describe, it, expect } from 'vitest'
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from './prompts'

// Smoke-tests: catch accidental reverts of the prompts to empty strings or
// the wrong text after a merge. Specifics are intentionally minimal so the
// tests don't have to be rewritten every time a prompt is tuned.
describe('shared prompts', () => {
  const all = {
    ANSWER_LAST_PROMPT,
    FOLLOW_UP_PROMPT,
    RECAP_PROMPT,
    SCREENSHOT_DEFAULT_PROMPT,
    SHORTEN_PROMPT,
    WHAT_TO_ANSWER_PROMPT
  }

  it.each(Object.entries(all))('%s is non-empty', (_name, prompt) => {
    expect(typeof prompt).toBe('string')
    expect(prompt.trim().length).toBeGreaterThan(20)
  })

  it('answer-last instructs no preamble', () => {
    expect(ANSWER_LAST_PROMPT.toLowerCase()).toContain('no preamble')
  })

  it('shorten references "previous answer"', () => {
    expect(SHORTEN_PROMPT.toLowerCase()).toContain('previous answer')
  })

  it('all prompts are unique', () => {
    const values = Object.values(all)
    const set = new Set(values)
    expect(set.size).toBe(values.length)
  })
})
