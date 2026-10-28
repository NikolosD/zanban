import { describe, it, expect } from 'vitest'
import { cleanSegments, cleanText } from './transcriptCleaner.js'
import type { TranscriptSegment } from '../../shared/types.js'

function seg(text: string): TranscriptSegment {
  return {
    id: text,
    channel: 'system',
    speaker: 0,
    startMs: 0,
    endMs: 1000,
    text,
    isFinal: true,
    createdAt: 0
  }
}

describe('cleanText', () => {
  it('strips Russian multi-word fillers', () => {
    expect(cleanText('Мы как бы готовы начать')).toBe('Мы готовы начать')
    expect(cleanText('В общем-то, это самое, всё по плану')).toBe('всё по плану')
  })

  it('keeps words that merely contain a filler phrase', () => {
    expect(cleanText('Никак бы не подумал')).toBe('Никак бы не подумал')
  })

  it('strips English multi-word fillers', () => {
    expect(cleanText('It is, you know, kind of done')).toBe('It is, done')
  })

  it('collapses repeated Cyrillic and Latin words', () => {
    expect(cleanText('Да да да, согласен')).toBe('Да, согласен')
    expect(cleanText('yeah yeah sounds good')).toBe('yeah sounds good')
  })
})

describe('cleanSegments', () => {
  it('keeps a short real answer', () => {
    expect(cleanSegments([seg('Пятьдесят тысяч.')]).map((s) => s.text)).toEqual([
      'Пятьдесят тысяч.'
    ])
  })

  it('drops filler-only and filler-heavy short segments', () => {
    expect(cleanSegments([seg('Ну вот.'), seg('эээ ну да'), seg('uh, um')])).toEqual([])
  })
})
