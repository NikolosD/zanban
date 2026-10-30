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
    expect(cleanText('It is, you know, done')).toBe('It is, done')
    expect(cleanText('I mean, we can ship it')).toBe('we can ship it')
  })

  it('keeps «это» and «вот» when they carry meaning', () => {
    const said = 'Мы сделали это вчера, а это завтра.'
    expect(cleanText(said)).toBe(said)
    expect(cleanText('Вот ссылка на документ')).toBe('Вот ссылка на документ')
    expect(cleanText('Это не вот это, а другое')).toBe('Это не вот это, а другое')
  })

  it('keeps "kind of" and "sort of" when they carry meaning', () => {
    expect(cleanText('What kind of database do you use?')).toBe('What kind of database do you use?')
    expect(cleanText('Some sort of cache sits in front of it')).toBe(
      'Some sort of cache sits in front of it'
    )
  })

  it('still strips the fillers that carry no meaning', () => {
    expect(cleanText('Ну, эм, мы готовы')).toBe('мы готовы')
    expect(cleanText('Um, uh, we are ready')).toBe('we are ready')
    expect(cleanText('В общем-то, это самое, всё по плану')).toBe('всё по плану')
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

  it('keeps a short segment made of words that only look like fillers', () => {
    const texts = ['Вот это да', 'Мы сделали это вчера, а это завтра.', 'What kind of database']
    expect(cleanSegments(texts.map(seg)).map((s) => s.text)).toEqual(texts)
  })
})
