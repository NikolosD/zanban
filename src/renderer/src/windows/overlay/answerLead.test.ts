import { describe, it, expect } from 'vitest'
import { splitAnswerLead } from './answerLead'

describe('splitAnswerLead', () => {
  it('takes a short bold first line as the lead and leaves the rest', () => {
    const out = splitAnswerLead('**Wrap the siblings in a fragment.**\n\n- one\n- two')
    expect(out).toEqual({ lead: 'Wrap the siblings in a fragment.', rest: '- one\n- two' })
  })

  it('works when the points follow on the very next line', () => {
    const out = splitAnswerLead('**Say it plainly**\n- one')
    expect(out).toEqual({ lead: 'Say it plainly', rest: '- one' })
  })

  it('reads inline code inside the lead as plain text', () => {
    expect(splitAnswerLead('**Wrap in `<>…</>`**\n\nmore').lead).toBe('Wrap in <>…</>')
  })

  it('leaves an answer that does not open with bold alone', () => {
    const answer = 'Wrap the siblings.\n\n- one'
    expect(splitAnswerLead(answer)).toEqual({ lead: null, rest: answer })
  })

  it('leaves bold that is only part of the first line', () => {
    const answer = '**Note** that this is a longer sentence.\n\nmore'
    expect(splitAnswerLead(answer)).toEqual({ lead: null, rest: answer })
  })

  it('leaves a bold line too long to be a verdict', () => {
    const answer = `**${'word '.repeat(40).trim()}**\n\nmore`
    expect(splitAnswerLead(answer).lead).toBeNull()
  })

  it('returns an empty answer untouched', () => {
    expect(splitAnswerLead('')).toEqual({ lead: null, rest: '' })
  })

  describe('while streaming', () => {
    it('shows nothing for the lone asterisks that open the bold', () => {
      expect(splitAnswerLead('*', true)).toEqual({ lead: '', rest: '' })
      expect(splitAnswerLead('**', true)).toEqual({ lead: '', rest: '' })
    })

    it('treats an unclosed bold line as the lead as soon as it has words', () => {
      expect(splitAnswerLead('**Wrap the', true)).toEqual({ lead: 'Wrap the', rest: '' })
      expect(splitAnswerLead('**Wrap the siblings*', true).lead).toBe('Wrap the siblings')
    })

    it('keeps the same lead once the bold closes and the body begins', () => {
      expect(splitAnswerLead('**Wrap the siblings**', true).lead).toBe('Wrap the siblings')
      expect(splitAnswerLead('**Wrap the siblings**\n', true)).toEqual({
        lead: 'Wrap the siblings',
        rest: ''
      })
      expect(splitAnswerLead('**Wrap the siblings**\n\n- on', true)).toEqual({
        lead: 'Wrap the siblings',
        rest: '- on'
      })
    })

    it('does not make a lead of plain text that merely has not shown bold yet', () => {
      expect(splitAnswerLead('Wrap the', true)).toEqual({ lead: null, rest: 'Wrap the' })
    })

    it('does not treat an unclosed bold as a lead once the answer is done', () => {
      const answer = '**Wrap the'
      expect(splitAnswerLead(answer, false)).toEqual({ lead: null, rest: answer })
    })
  })
})
