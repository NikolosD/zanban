import { describe, expect, it } from 'vitest'
import { recapSchema, RECAP_SCHEMA_VERSION } from './recapSchema.js'

describe('recapSchema', () => {
  it('accepts a fully-populated payload', () => {
    const parsed = recapSchema.parse({
      tldr: 'We agreed on Q3 milestones.',
      decisions: ['Ship beta by July 15'],
      actionItems: [
        { text: 'Send design doc', owner: 'you' },
        { text: 'Review API contract', owner: 'them', dueHint: 'by Friday' }
      ],
      openQuestions: ['What is the rollout plan for EU users?'],
      followUp: { subject: 'Q3 sync follow-up', body: 'Thanks for the call...' }
    })
    expect(parsed.actionItems[0]?.owner).toBe('you')
    expect(parsed.actionItems[1]?.dueHint).toBe('by Friday')
  })

  it('defaults arrays to empty and follow-up nullable', () => {
    const parsed = recapSchema.parse({ tldr: 'Short call.', followUp: null })
    expect(parsed.decisions).toEqual([])
    expect(parsed.actionItems).toEqual([])
    expect(parsed.openQuestions).toEqual([])
    expect(parsed.followUp).toBeNull()
  })

  it('rejects empty tldr', () => {
    const result = recapSchema.safeParse({ tldr: '', followUp: null })
    expect(result.success).toBe(false)
  })

  it('coerces unknown owner to "unknown" via default', () => {
    const parsed = recapSchema.parse({
      tldr: 'x',
      actionItems: [{ text: 'do thing' }],
      followUp: null
    })
    expect(parsed.actionItems[0]?.owner).toBe('unknown')
  })

  it('exports a stable schema version', () => {
    expect(RECAP_SCHEMA_VERSION).toBe(1)
  })
})
