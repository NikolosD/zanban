import { describe, it, expect } from 'vitest'
import { inlineCodeClass } from './inlineCode'

describe('inlineCodeClass', () => {
  it('keeps a short token on one line so <div> never splits', () => {
    const cls = inlineCodeClass('<div>')
    expect(cls).toContain('whitespace-nowrap')
    expect(cls).not.toContain('break-')
  })

  it('wraps a long token at word breaks, never mid-character', () => {
    const cls = inlineCodeClass('const [number, setNumber] = useState<number>(0)')
    expect(cls).toContain('break-words')
    expect(cls).not.toContain('break-all')
    expect(cls).not.toContain('whitespace-nowrap')
  })

  it('treats the 24-character boundary as long', () => {
    expect(inlineCodeClass('a'.repeat(23))).toContain('whitespace-nowrap')
    expect(inlineCodeClass('a'.repeat(24))).toContain('break-words')
  })

  it('wraps content that is not a plain string', () => {
    expect(inlineCodeClass(['a', 'b'])).toContain('break-words')
    expect(inlineCodeClass(undefined)).toContain('break-words')
  })
})
