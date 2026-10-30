import { describe, expect, it } from 'vitest'
import { rehypeCodeLines } from './rehypeCodeLines'

type Node = Record<string, unknown>

const text = (value: string): Node => ({ type: 'text', value })
const el = (tagName: string, children: Node[], className?: string[]): Node => ({
  type: 'element',
  tagName,
  properties: className ? { className } : {},
  children
})

function run(codeChildren: Node[]): Node {
  const code = el('code', codeChildren, ['language-js'])
  const tree = { type: 'root', children: [el('pre', [code])] }
  rehypeCodeLines()(tree as never)
  return code
}

function lineTexts(code: Node): string[] {
  const read = (n: Node): string =>
    n.type === 'text' ? (n.value as string) : (n.children as Node[]).map(read).join('')
  return (code.children as Node[]).map(read)
}

describe('rehypeCodeLines', () => {
  it('wraps each line in a .zb-line span and marks the code element', () => {
    const code = run([text('one\ntwo\n')])

    expect(lineTexts(code)).toEqual(['one\n', 'two\n'])
    expect(
      (code.children as Node[]).every(
        (l) => (l.properties as { className: string[] }).className[0] === 'zb-line'
      )
    ).toBe(true)
    expect((code.properties as Node).className).toEqual(['language-js', 'zb-code'])
  })

  it('keeps the text exactly, so a copy gains and loses no newline', () => {
    const source = 'a\n\n  indented\nlast without newline'

    expect(lineTexts(run([text(source)])).join('')).toBe(source)
  })

  it('keeps blank lines as lines of their own', () => {
    expect(lineTexts(run([text('a\n\nb\n')]))).toEqual(['a\n', '\n', 'b\n'])
  })

  it('splits a highlight span that crosses lines, wrapping it on every line', () => {
    const code = run([
      text('x '),
      el('span', [text('/* a\nb */')], ['hljs-comment']),
      text('\ny\n')
    ])

    expect(lineTexts(code)).toEqual(['x /* a\n', 'b */\n', 'y\n'])
    const second = (code.children as Node[])[1]!
    const wrapped = (second.children as Node[])[0]!
    expect(wrapped.tagName).toBe('span')
    expect((wrapped.properties as Node).className).toEqual(['hljs-comment'])
  })

  it('leaves code outside a pre alone', () => {
    const inline = el('code', [text('a\nb')])
    const tree = { type: 'root', children: [el('p', [inline])] }

    rehypeCodeLines()(tree as never)

    expect(inline.children).toEqual([text('a\nb')])
  })
})
