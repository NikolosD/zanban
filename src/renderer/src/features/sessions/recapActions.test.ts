import { describe, expect, it } from 'vitest'
import { formatRecapAsMarkdown, formatFollowUpAsPlainText } from './recapActions'
import type { RecapPayload } from '@shared/recap-types'

const recap: RecapPayload = {
  schemaVersion: 1,
  tldr: 'We aligned on Q3 scope.',
  decisions: ['Ship beta July 15'],
  actionItems: [
    { text: 'Send PRD', owner: 'you', dueHint: 'tomorrow' },
    { text: 'Review API contract', owner: 'them' }
  ],
  openQuestions: ['What about EU rollout?'],
  followUp: { subject: 'Q3 sync follow-up', body: 'Hi team,\n\nThanks for the call.' },
  generatedAt: 0,
  model: 'm',
  promptVersion: 1
}

describe('formatRecapAsMarkdown', () => {
  it('renders all sections', () => {
    const md = formatRecapAsMarkdown(recap)
    expect(md).toContain('# TL;DR')
    expect(md).toContain('We aligned on Q3 scope.')
    expect(md).toContain('## Decisions')
    expect(md).toContain('## Action items')
    expect(md).toContain('- (You) Send PRD — tomorrow')
    expect(md).toContain('- (Them) Review API contract')
    expect(md).toContain('## Open questions')
    expect(md).toContain('## Follow-up')
  })

  it('omits empty sections', () => {
    const md = formatRecapAsMarkdown({
      ...recap,
      decisions: [],
      openQuestions: [],
      followUp: null
    })
    expect(md).not.toContain('## Decisions')
    expect(md).not.toContain('## Open questions')
    expect(md).not.toContain('## Follow-up')
  })
})

describe('formatFollowUpAsPlainText', () => {
  it('returns subject + blank line + body', () => {
    const out = formatFollowUpAsPlainText(recap.followUp!)
    expect(out).toBe('Subject: Q3 sync follow-up\n\nHi team,\n\nThanks for the call.')
  })

  it('strips markdown emphasis', () => {
    const out = formatFollowUpAsPlainText({
      subject: 'Hello',
      body: '**Bold** and *italic* with [link](https://x)'
    })
    expect(out).toBe('Subject: Hello\n\nBold and italic with link')
  })
})
