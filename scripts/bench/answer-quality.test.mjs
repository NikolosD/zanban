import { describe, expect, it, vi } from 'vitest'
import { RUBRICS } from './answer-rubrics.mjs'
import {
  autoCoverage,
  buildJudgePrompt,
  coveragePct,
  loadSourceAtRef,
  parseJudge,
  pickOrder,
  renderMarkdown,
  unblind,
  verdictForKind,
  verdictLines
} from './answer-quality.mjs'

const side = (covered, extra = {}) => ({
  covered,
  factual_error: false,
  error_reason: '',
  speech: 3,
  ...extra
})
const reply = (a, b, preference = 'A', reason = 'because') =>
  JSON.stringify({ A: a, B: b, preference, reason })

describe('rubrics', () => {
  it('has 3-5 points with valid keyword patterns for every case', () => {
    const entries = Object.entries(RUBRICS)
    expect(entries).toHaveLength(16)
    for (const [, points] of entries) {
      expect(points.length).toBeGreaterThanOrEqual(3)
      expect(points.length).toBeLessThanOrEqual(5)
      for (const pt of points) expect(() => new RegExp(pt.kw, 'iu')).not.toThrow()
    }
  })
})

describe('parseJudge', () => {
  it('parses strict JSON', () => {
    const parsed = parseJudge(reply(side([true, false, true]), side([true, true, true]), 'B'), 3)
    expect(parsed.A.covered).toEqual([true, false, true])
    expect(parsed.B.speech).toBe(3)
    expect(parsed.preference).toBe('B')
  })

  it('tolerates code fences and surrounding prose', () => {
    const text = `Here:\n\`\`\`json\n${reply(side([true]), side([false]), 'tie')}\n\`\`\``
    expect(parseJudge(text, 1).preference).toBe('tie')
  })

  it('keeps the factual error reason only when flagged', () => {
    const flagged = side([true], { factual_error: true, error_reason: 'TCP is not faster' })
    const parsed = parseJudge(reply(flagged, side([true], { error_reason: 'ignored' })), 1)
    expect(parsed.A).toMatchObject({ factualError: true, errorReason: 'TCP is not faster' })
    expect(parsed.B).toMatchObject({ factualError: false, errorReason: '' })
  })

  it.each([
    ['no JSON', 'sorry, cannot', 1],
    ['broken JSON', '{"A": ', 1],
    ['wrong covered length', reply(side([true]), side([true, true])), 1],
    ['non-boolean covered', reply(side(['yes', true]), side([true, true])), 2],
    ['speech out of range', reply(side([true], { speech: 6 }), side([true])), 1],
    ['fractional speech', reply(side([true], { speech: 2.5 }), side([true])), 1],
    ['bad preference', reply(side([true]), side([true]), 'C'), 1],
    ['missing side', JSON.stringify({ A: side([true]), preference: 'A' }), 1]
  ])('rejects %s', (_, text, n) => {
    expect(() => parseJudge(text, n)).toThrow()
  })
})

describe('unblind', () => {
  const parsed = parseJudge(
    reply(side([true, false]), side([true, true], { speech: 5 }), 'B', 'tighter'),
    2
  )

  it('maps A and B back when old was shown as A', () => {
    const r = unblind(parsed, { A: 'old', B: 'new' })
    expect(r.old.covered).toEqual([true, false])
    expect(r.new.speech).toBe(5)
    expect(r.preference).toBe('new')
  })

  it('maps A and B back when new was shown as A', () => {
    const r = unblind(parsed, { A: 'new', B: 'old' })
    expect(r.new.covered).toEqual([true, false])
    expect(r.old.speech).toBe(5)
    expect(r.preference).toBe('old')
    expect(r.reason).toBe('tighter')
  })

  it('keeps ties as ties', () => {
    const tie = parseJudge(reply(side([true]), side([true]), 'tie'), 1)
    expect(unblind(tie, { A: 'new', B: 'old' }).preference).toBe('tie')
  })
})

describe('pickOrder and buildJudgePrompt', () => {
  it('is deterministic with an injected rng and puts answers in the picked slots', () => {
    const order = pickOrder(() => 0.9)
    expect(order).toEqual({ A: 'new', B: 'old' })
    expect(pickOrder(() => 0.1)).toEqual({ A: 'old', B: 'new' })
    const text = buildJudgePrompt(
      'Q?',
      [{ text: 'point one' }],
      { old: 'OLDANS', new: 'NEWANS' },
      order
    )
    expect(text.indexOf('NEWANS')).toBeLessThan(text.indexOf('OLDANS'))
    expect(text).toContain('1. point one')
    expect(text).not.toMatch(/\bold\b|\bnew\b/i)
  })
})

describe('autoCoverage', () => {
  const points = RUBRICS['Какие правила работы с ключами и для чего их ещё используют?']

  it('matches keywords per point, case-insensitively', () => {
    const text =
      'Ключ должен быть СТАБИЛЬНЫМ. Индекс массива не годится. Смена key сбросит состояние.'
    expect(autoCoverage(text, points)).toEqual([true, true, false, true])
  })

  it('returns all false for unrelated text and 0 percent', () => {
    const flags = autoCoverage('hello', points)
    expect(flags.every((f) => f === false)).toBe(true)
    expect(coveragePct(flags)).toBe(0)
  })

  it('computes percentages and handles empty input', () => {
    expect(coveragePct([true, false, true, true])).toBe(75)
    expect(coveragePct([])).toBe(0)
  })

  it('flags the salary-only answer rule with a negative lookahead', () => {
    const pt = RUBRICS['Why do you want to work at our company?'][3]
    expect(autoCoverage('I like your mission', [pt])).toEqual([true])
    expect(autoCoverage('Mostly the salary', [pt])).toEqual([false])
  })
})

describe('verdicts', () => {
  const judgeSide = (n, covered, speech = 3, factualError = false) => ({
    covered: [...Array(covered).fill(true), ...Array(n - covered).fill(false)],
    factualError,
    errorReason: '',
    speech
  })
  const row = (oldJ, newJ, docOld = 2, docNew = 0) => ({
    judge: { old: oldJ, new: newJ },
    oldM: { docMarkers: docOld },
    newM: { docMarkers: docNew }
  })

  it('holds quality when coverage drops by exactly the limit or less', () => {
    const v = verdictForKind([row(judgeSide(10, 10), judgeSide(10, 9))])
    expect(v.covDelta).toBeCloseTo(-10)
    expect(v.qualityHeld).toBe(true)
  })

  it('drops quality when coverage falls by more than 10 points', () => {
    const v = verdictForKind([row(judgeSide(10, 10), judgeSide(10, 8))])
    expect(v.qualityHeld).toBe(false)
  })

  it('drops quality on any new factual error even with full coverage', () => {
    const v = verdictForKind([row(judgeSide(4, 4), judgeSide(4, 4, 3, true))])
    expect(v.newErrors).toBe(1)
    expect(v.qualityHeld).toBe(false)
  })

  it('does not count an error the old answer also made as new', () => {
    const v = verdictForKind([row(judgeSide(4, 4, 3, true), judgeSide(4, 4, 3, true))])
    expect(v.newErrors).toBe(0)
    expect(v.qualityHeld).toBe(true)
  })

  it('requires a speech gain and no more doc markers for speakability', () => {
    expect(verdictForKind([row(judgeSide(4, 4, 2), judgeSide(4, 4, 4))]).speakabilityImproved).toBe(
      true
    )
    expect(verdictForKind([row(judgeSide(4, 4, 3), judgeSide(4, 4, 3))]).speakabilityImproved).toBe(
      false
    )
    expect(
      verdictForKind([row(judgeSide(4, 4, 2), judgeSide(4, 4, 4), 0, 1)]).speakabilityImproved
    ).toBe(false)
  })

  it('ignores cases where the judge failed', () => {
    const v = verdictForKind([
      row(judgeSide(4, 4), judgeSide(4, 4)),
      { judge: undefined, oldM: { docMarkers: 0 }, newM: { docMarkers: 0 } }
    ])
    expect(v.judged).toBe(1)
  })

  it('formats the verdict lines', () => {
    const held = verdictLines(
      'coding',
      verdictForKind([row(judgeSide(4, 4, 2), judgeSide(4, 4, 4))])
    )
    expect(held[0]).toContain('quality held')
    expect(held[1]).toContain('speakability improved')
    const bad = verdictLines('coding', verdictForKind([row(judgeSide(4, 4), judgeSide(4, 1))]))
    expect(bad[0]).toContain('quality dropped')
    expect(bad[1]).toContain('speakability not improved')
    expect(verdictLines('coding', verdictForKind([]))).toEqual(['coding: no judged cases'])
  })
})

describe('loadSourceAtRef', () => {
  it('reads the given ref through git show', () => {
    const git = vi.fn(() => 'export const x = 1')
    const out = loadSourceAtRef('feat/tighter-spoken', 'src/main/ai/prompts.ts', {
      root: '/repo',
      git
    })
    expect(out).toBe('export const x = 1')
    expect(git).toHaveBeenCalledWith(
      'git',
      ['show', 'feat/tighter-spoken:src/main/ai/prompts.ts'],
      { cwd: '/repo', encoding: 'utf8' }
    )
  })

  it('does not call git for the working tree', () => {
    const git = vi.fn()
    const out = loadSourceAtRef(null, 'package.json', { root: process.cwd(), git })
    expect(git).not.toHaveBeenCalled()
    expect(out).toContain('"name"')
  })

  it('propagates git failures for unknown refs', () => {
    const git = vi.fn(() => {
      throw new Error('fatal: invalid object name')
    })
    expect(() => loadSourceAtRef('nope', 'a.ts', { root: '/repo', git })).toThrow(/invalid object/)
  })
})

describe('renderMarkdown', () => {
  it('shows both answers side by side with the unblinded order', () => {
    const points = [{ text: 'point one' }]
    const m = {
      words: 5,
      codeLines: 0,
      leadOk: true,
      avgSentence: 4,
      maxSentence: 6,
      docMarkers: 0
    }
    const md = renderMarkdown({
      meta: ['Model: x'],
      summaryLines: ['Averages'],
      rows: [
        {
          kind: 'conceptual',
          prompt: 'Q?',
          points,
          oldText: 'old answer',
          newText: 'new answer',
          oldM: m,
          newM: m,
          oldAuto: [true],
          newAuto: [false],
          judge: {
            old: { covered: [true], speech: 2, factualError: false, errorReason: '' },
            new: { covered: [false], speech: 4, factualError: true, errorReason: 'wrong' },
            preference: 'old',
            reason: 'complete',
            order: { A: 'new', B: 'old' }
          }
        }
      ]
    })
    expect(md).toContain('> old answer')
    expect(md).toContain('> new answer')
    expect(md).toContain('A=new, B=old')
    expect(md).toContain('YES (wrong)')
    expect(md).toContain('- [x] [ ] point one')
  })
})
