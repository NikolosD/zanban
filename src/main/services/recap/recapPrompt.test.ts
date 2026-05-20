import { describe, expect, it } from 'vitest'
import { buildRecapPrompt, PROMPT_VERSION } from './recapPrompt.js'
import type { SessionDetailPayload } from '../../../shared/api.js'

const session: SessionDetailPayload = {
  id: 'abc',
  startedAt: 0,
  endedAt: 60_000,
  title: 'Q3 sync',
  segments: [
    { channel: 'mic', startMs: 0, text: 'Lets ship by July.' },
    { channel: 'system', startMs: 1000, text: 'Sounds good, Ill send the doc.' }
  ],
  exchanges: [],
  filePath: '/tmp/abc.json'
}

describe('buildRecapPrompt', () => {
  it('emits a system prompt that names every schema field', () => {
    const { system } = buildRecapPrompt(session, {})
    for (const key of ['tldr', 'decisions', 'actionItems', 'openQuestions', 'followUp']) {
      expect(system).toContain(key)
    }
    expect(system).toMatch(/JSON/i)
  })

  it('labels mic as You and system as Them in the transcript block', () => {
    const { user } = buildRecapPrompt(session, {})
    expect(user).toContain('[You] Lets ship by July.')
    expect(user).toContain('[Them] Sounds good, Ill send the doc.')
  })

  it('inserts tone hint when provided', () => {
    const { system } = buildRecapPrompt(session, { tone: 'friendly' })
    expect(system.toLowerCase()).toContain('friendly')
  })

  it('forces language when not auto', () => {
    const { system: en } = buildRecapPrompt(session, { language: 'en' })
    expect(en).toMatch(/respond in english/i)
    const { system: ru } = buildRecapPrompt(session, { language: 'ru' })
    expect(ru).toMatch(/respond in russian/i)
  })

  it('omits language instruction when auto', () => {
    const { system } = buildRecapPrompt(session, { language: 'auto' })
    expect(system).not.toMatch(/respond in (english|russian)/i)
  })

  it('exports a stable prompt version', () => {
    expect(PROMPT_VERSION).toBe(1)
  })

  it('handles empty exchanges gracefully', () => {
    const { user } = buildRecapPrompt({ ...session, exchanges: [] }, {})
    expect(user).not.toContain('<exchanges>')
  })
})
