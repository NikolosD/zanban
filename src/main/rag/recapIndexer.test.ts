import { describe, it, expect } from 'vitest'
import { recapToText, type IndexableRecap } from './recapIndexer.js'

function recap(over: Partial<IndexableRecap> = {}): IndexableRecap {
  return {
    tldr: '',
    decisions: [],
    actionItems: [],
    openQuestions: [],
    ...over
  }
}

describe('recapToText', () => {
  it('returns an empty string when the recap is empty', () => {
    expect(recapToText(recap())).toBe('')
  })

  it('includes the TL;DR as a Summary line', () => {
    expect(recapToText(recap({ tldr: 'We shipped the thing.' }))).toContain(
      'Summary: We shipped the thing.'
    )
  })

  it('joins decisions with semicolons', () => {
    const out = recapToText(recap({ decisions: ['use Postgres', 'ship Friday'] }))
    expect(out).toContain('Decisions: use Postgres; ship Friday')
  })

  it('renders action items with owner labels and due hints', () => {
    const out = recapToText(
      recap({
        actionItems: [
          { text: 'send recap', owner: 'you', dueHint: 'today' },
          { text: 'review PR', owner: 'them' },
          { text: 'pick a date', owner: 'unknown' }
        ]
      })
    )
    expect(out).toContain('You — send recap (today)')
    expect(out).toContain('Them — review PR')
    expect(out).toContain('Someone — pick a date')
  })

  it('includes open questions', () => {
    expect(recapToText(recap({ openQuestions: ['who owns billing?'] }))).toContain(
      'Open questions: who owns billing?'
    )
  })

  it('omits sections that have no content', () => {
    const out = recapToText(recap({ tldr: 'only this' }))
    expect(out).not.toContain('Decisions:')
    expect(out).not.toContain('Action items:')
    expect(out).not.toContain('Open questions:')
  })
})
