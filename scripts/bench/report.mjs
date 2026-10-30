import { mean } from './metrics.mjs'
import { BACKGROUNDS } from './backgrounds.mjs'

const BACKGROUND_COUNT = BACKGROUNDS.length

export const METRICS = [
  { key: 'contrastMedian', label: 'text contrast, median (x:1)', better: 'higher', digits: 2 },
  { key: 'contrastP10', label: 'text contrast, p10 (x:1)', better: 'higher', digits: 2 },
  {
    key: 'contrastP10Clear',
    label: 'text contrast, p10 outside the bottom fade (x:1)',
    better: 'higher',
    digits: 2
  },
  {
    key: 'declaredMedian',
    label: 'declared text contrast, median (x:1)',
    better: 'higher',
    digits: 2
  },
  { key: 'declaredP10', label: 'declared text contrast, p10 (x:1)', better: 'higher', digits: 2 },
  { key: 'declaredMin', label: 'declared text contrast, min (x:1)', better: 'higher', digits: 2 },
  { key: 'bleed', label: 'background bleed (0-1)', better: 'lower', digits: 3 },
  { key: 'aboveFold', label: 'above the fold (share of chars)', better: 'higher', digits: 3 },
  { key: 'verdictY', label: 'verdict y (px from top)', better: 'lower', digits: 0 },
  {
    key: 'verdictVisible',
    label: 'verdict visible without scrolling (share)',
    better: 'higher',
    digits: 2
  },
  { key: 'verdictFont', label: 'verdict font (px)', better: 'higher', digits: 1 },
  { key: 'cutLines', label: 'lines cut at scroll edge', better: 'lower', digits: 0 },
  { key: 'hClipped', label: 'words clipped sideways', better: 'lower', digits: 0 },
  { key: 'answerShare', label: 'answer share of panel', better: 'higher', digits: 3 },
  { key: 'codePx', label: 'code font (px)', better: 'higher', digits: 1 },
  { key: 'bodyPx', label: 'body font (px)', better: 'higher', digits: 1 },
  { key: 'codeToBody', label: 'code / body font', better: 'higher', digits: 2 }
]

const fmt = (v, digits) => (v === null || v === undefined ? 'n/a' : v.toFixed(digits))

export function summarize(cases) {
  const out = {}
  for (const m of METRICS) out[m.key] = mean(cases.map((c) => c[m.key]))
  const p10s = cases.map((c) => c.contrastP10).filter((v) => v !== null)
  out.worstContrastP10 = p10s.length ? Math.min(...p10s) : null
  out.worstBleed = Math.max(...cases.map((c) => c.bleed))
  return out
}

export function caseTable(results) {
  const head = [
    'scenario',
    'background',
    'contrast med',
    'contrast p10',
    'bleed',
    'above fold',
    'verdict y',
    'verdict seen',
    'verdict px',
    'cut lines',
    'h-clipped',
    'answer share',
    'code px',
    'body px'
  ]
  const rows = results.cases.map((c) => [
    c.scenario,
    c.background,
    fmt(c.contrastMedian, 2),
    fmt(c.contrastP10, 2),
    fmt(c.bleed, 3),
    fmt(c.aboveFold, 3),
    fmt(c.verdictY, 0),
    fmt(c.verdictVisible, 0),
    fmt(c.verdictFont, 1),
    fmt(c.cutLines, 0),
    fmt(c.hClipped, 0),
    fmt(c.answerShare, 3),
    fmt(c.codePx, 1),
    fmt(c.bodyPx, 1)
  ])
  return [head, ...rows]
    .map((r, i) => `| ${r.join(' | ')} |${i === 0 ? `\n|${r.map(() => '---').join('|')}|` : ''}`)
    .join('\n')
}

export function toMarkdown(results) {
  const s = results.summary
  const lines = [
    `# Overlay readability: ${results.label}`,
    '',
    `Build: \`${results.out}\`  `,
    `Run: ${results.createdAt}  `,
    `Window: ${results.window.width}x${results.window.height} max, ${results.cases.length} cases`,
    '',
    '## Summary (mean over all cases)',
    '',
    '| metric | value | better |',
    '|---|---|---|',
    ...METRICS.map((m) => `| ${m.label} | ${fmt(s[m.key], m.digits)} | ${m.better} |`),
    `| worst-case contrast p10 (x:1) | ${fmt(s.worstContrastP10, 2)} | higher |`,
    `| worst-case bleed (0-1) | ${fmt(s.worstBleed, 3)} | lower |`,
    '',
    '## Per scenario and background',
    '',
    caseTable(results),
    ''
  ]
  return lines.join('\n')
}

function verdict(a, b, better) {
  if (a === null || b === null) return ''
  const eps = 1e-9
  if (Math.abs(b - a) < eps) return 'same'
  const bWins = better === 'higher' ? b > a : b < a
  return bWins ? 'B' : 'A'
}

function deltaCell(a, b, digits) {
  if (a === null || b === null) return 'n/a'
  const d = b - a
  return `${d >= 0 ? '+' : ''}${d.toFixed(digits)}`
}

function compareRows(sa, sb) {
  const rows = METRICS.map((m) => [m.label, sa[m.key], sb[m.key], m.digits, m.better])
  rows.push([
    'worst-case contrast p10 (x:1)',
    sa.worstContrastP10,
    sb.worstContrastP10,
    2,
    'higher'
  ])
  rows.push(['worst-case bleed (0-1)', sa.worstBleed, sb.worstBleed, 3, 'lower'])
  return rows
}

function table(labelA, labelB, rows) {
  const out = [
    `| metric | ${labelA} (A) | ${labelB} (B) | delta B-A | better |`,
    '|---|---|---|---|---|'
  ]
  for (const [label, a, b, digits, better] of rows) {
    const win = verdict(a, b, better)
    const mark = win === 'A' ? `A (${labelA})` : win === 'B' ? `B (${labelB})` : win
    out.push(
      `| ${label} | ${fmt(a, digits)} | ${fmt(b, digits)} | ${deltaCell(a, b, digits)} | ${mark} |`
    )
  }
  return out.join('\n')
}

export function compareMarkdown(a, b) {
  const ids = [...new Set(a.cases.map((c) => c.scenario))].filter((id) =>
    b.cases.some((c) => c.scenario === id)
  )
  const common = (r) => summarize(r.cases.filter((c) => ids.includes(c.scenario)))
  const lines = [
    `# ${a.label} (A) vs ${b.label} (B)`,
    '',
    `## Mean over ${ids.length} shared scenarios x ${BACKGROUND_COUNT} backgrounds`,
    '',
    table(a.label, b.label, compareRows(common(a), common(b)))
  ]
  for (const id of ids) {
    const pick = (r) => summarize(r.cases.filter((c) => c.scenario === id))
    lines.push(
      '',
      `## ${id} (mean over backgrounds)`,
      '',
      table(a.label, b.label, compareRows(pick(a), pick(b)))
    )
  }
  return lines.join('\n') + '\n'
}
