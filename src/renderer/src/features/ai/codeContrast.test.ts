/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SURFACE = '#0d1117'
const MIN_CONTRAST = 7
const css = readFileSync(new URL('./streamingMarkdown.css', import.meta.url), 'utf8')

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

function colorOf(selector: string): string {
  const rule = new RegExp(
    `${selector.replace('.', '\\.')}\\s*[,{][^}]*?color:\\s*(#[0-9a-f]{6})`,
    'i'
  )
  const match = css.match(rule)
  if (!match) throw new Error(`no colour for ${selector}`)
  return match[1]!
}

describe('code colours on the code surface', () => {
  it.each([
    '.hljs-keyword',
    '.hljs-tag',
    '.hljs-name',
    '.hljs-comment',
    '.hljs-deletion',
    '.hljs-addition',
    '.zb-lang',
    '.hljs-string',
    '.hljs-number',
    '.hljs-title',
    '.hljs-attribute'
  ])('%s reaches %i:1', (selector) => {
    expect(contrast(colorOf(selector), SURFACE)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('keeps comments quieter than code', () => {
    expect(contrast(colorOf('.hljs-comment'), SURFACE)).toBeLessThan(contrast('#e6edf3', SURFACE))
  })
})
