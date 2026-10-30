import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const JUDGE_SYSTEM = `You are a strict, impartial evaluator of interview answers. You will see a question, a rubric of must-cover points, and two candidate answers labelled A and B. The answers are meant to be read at a glance and said aloud by a candidate in a live interview.

Judge each answer independently:
- covered: for every rubric point, in order, true if the answer states it (explicitly or clearly implied), else false.
- factual_error: true only if the answer contains a statement that is technically wrong; give a short reason, or an empty string.
- speech: an integer 1-5 for how much it sounds like natural speech a person could say aloud (1 = reads like documentation, 5 = natural spoken language).
Then give preference: "A", "B" or "tie", for which answer is better overall for this interview, with a one-line reason.

Reply with strict JSON only, no prose and no code fences:
{"A":{"covered":[true],"factual_error":false,"error_reason":"","speech":3},"B":{"covered":[true],"factual_error":false,"error_reason":"","speech":3},"preference":"A","reason":"..."}`

export function loadSourceAtRef(ref, path, { root, git = execFileSync } = {}) {
  if (!ref) return readFileSync(join(root, path), 'utf8')
  return git('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
}

export function pickOrder(rng = Math.random) {
  return rng() < 0.5 ? { A: 'old', B: 'new' } : { A: 'new', B: 'old' }
}

export function buildJudgePrompt(question, points, answers, order) {
  const rubric = points.map((pt, i) => `${i + 1}. ${pt.text}`).join('\n')
  return `Question:\n${question}\n\nRubric (${points.length} points):\n${rubric}\n\n=== Answer A ===\n${answers[order.A]}\n\n=== Answer B ===\n${answers[order.B]}`
}

function parseSide(side, n, label) {
  if (!side || !Array.isArray(side.covered) || side.covered.length !== n) {
    throw new Error(`Judge answer ${label}: expected ${n} covered flags`)
  }
  if (!side.covered.every((v) => typeof v === 'boolean')) {
    throw new Error(`Judge answer ${label}: covered must be booleans`)
  }
  const speech = Number(side.speech)
  if (!Number.isInteger(speech) || speech < 1 || speech > 5) {
    throw new Error(`Judge answer ${label}: speech must be an integer 1-5`)
  }
  const flagged = side.factual_error === true
  return {
    covered: side.covered,
    factualError: flagged,
    errorReason: flagged ? String(side.error_reason ?? '') : '',
    speech
  }
}

export function parseJudge(text, n) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Judge reply contains no JSON object')
  let raw
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('Judge reply is not valid JSON')
  }
  const preference = String(raw.preference ?? '').toUpperCase()
  if (!['A', 'B', 'TIE'].includes(preference)) {
    throw new Error('Judge preference must be A, B or tie')
  }
  return {
    A: parseSide(raw.A, n, 'A'),
    B: parseSide(raw.B, n, 'B'),
    preference: preference === 'TIE' ? 'tie' : preference,
    reason: String(raw.reason ?? '')
  }
}

export function unblind(parsed, order) {
  return {
    old: parsed[order.A === 'old' ? 'A' : 'B'],
    new: parsed[order.A === 'new' ? 'A' : 'B'],
    preference: parsed.preference === 'tie' ? 'tie' : order[parsed.preference],
    reason: parsed.reason,
    order
  }
}

export function autoCoverage(text, points) {
  return points.map((pt) => new RegExp(pt.kw, 'iu').test(text))
}

export const coveragePct = (flags) =>
  flags.length ? (flags.filter(Boolean).length / flags.length) * 100 : 0

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export const COVERAGE_DROP_LIMIT = 10
export const SPEECH_GAIN_MIN = 0.25

export function verdictForKind(rows) {
  const judged = rows.filter((r) => r.judge)
  const covOld = avg(judged.map((r) => coveragePct(r.judge.old.covered)))
  const covNew = avg(judged.map((r) => coveragePct(r.judge.new.covered)))
  const newErrors = judged.filter((r) => r.judge.new.factualError && !r.judge.old.factualError)
  const covDelta = covNew - covOld
  const speechOld = avg(judged.map((r) => r.judge.old.speech))
  const speechNew = avg(judged.map((r) => r.judge.new.speech))
  const docOld = avg(rows.map((r) => r.oldM.docMarkers))
  const docNew = avg(rows.map((r) => r.newM.docMarkers))
  const speechDelta = speechNew - speechOld
  return {
    judged: judged.length,
    covOld,
    covNew,
    covDelta,
    newErrors: newErrors.length,
    speechOld,
    speechNew,
    speechDelta,
    qualityHeld: covDelta >= -COVERAGE_DROP_LIMIT && newErrors.length === 0,
    speakabilityImproved: speechDelta >= SPEECH_GAIN_MIN && docNew <= docOld
  }
}

export function verdictLines(kind, v) {
  if (v.judged === 0) return [`${kind}: no judged cases`]
  return [
    `${kind}: ${v.qualityHeld ? 'quality held' : 'quality dropped'} ` +
      `(coverage ${v.covOld.toFixed(0)}% -> ${v.covNew.toFixed(0)}%, ` +
      `new factual errors ${v.newErrors})`,
    `${kind}: ${v.speakabilityImproved ? 'speakability improved' : 'speakability not improved'} ` +
      `(speech ${v.speechOld.toFixed(2)} -> ${v.speechNew.toFixed(2)})`
  ]
}

export const POWERSHELL_KEY_HINT =
  "PowerShell (5.1+), without echoing the key:\n  $s = Read-Host -AsSecureString 'key'; $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"

function side(label, m, auto, judgeSide, points) {
  const lines = [`**${label}**`, '']
  lines.push(
    `words ${m.words}, code lines ${m.codeLines}, lead<=15 ${m.leadOk ? 'yes' : 'no'}, ` +
      `avg sent ${m.avgSentence.toFixed(1)}, max sent ${m.maxSentence}, doc marks ${m.docMarkers}`
  )
  if (judgeSide) {
    lines.push(
      `judge coverage ${coveragePct(judgeSide.covered).toFixed(0)}%, ` +
        `speech ${judgeSide.speech}/5, factual error ${judgeSide.factualError ? `YES (${judgeSide.errorReason})` : 'no'}`
    )
  }
  lines.push(`keyword coverage ${coveragePct(auto).toFixed(0)}%`)
  return lines.join('\n') + `\n\n${points}`
}

export function renderMarkdown({ meta, rows, summaryLines }) {
  const out = [`# Answer bench`, '', ...meta.map((m) => `- ${m}`), '']
  out.push('## Summary', '', '```', ...summaryLines, '```', '')
  for (const r of rows) {
    out.push(`## [${r.kind}] ${r.prompt}`, '')
    const marks = (flags) => r.points.map((pt, i) => `${flags[i] ? '[x]' : '[ ]'} ${pt.text}`)
    out.push('Rubric (judge old / new):', '')
    r.points.forEach((pt, i) => {
      const o = r.judge ? (r.judge.old.covered[i] ? 'x' : ' ') : '?'
      const n = r.judge ? (r.judge.new.covered[i] ? 'x' : ' ') : '?'
      out.push(`- [${o}] [${n}] ${pt.text}`)
    })
    out.push('')
    if (r.judge) {
      out.push(
        `Judge preference: ${r.judge.preference} (${r.judge.reason}). Presented as A=${r.judge.order.A}, B=${r.judge.order.B}.`,
        ''
      )
    } else if (r.judgeError) {
      out.push(`Judge failed: ${r.judgeError}`, '')
    }
    const oldBlock = side('OLD', r.oldM, r.oldAuto, r.judge?.old, marks(r.oldAuto).join('\n'))
    const newBlock = side('NEW', r.newM, r.newAuto, r.judge?.new, marks(r.newAuto).join('\n'))
    out.push('### OLD', '', oldBlock, '', '#### answer', '', quote(r.oldText), '')
    out.push('### NEW', '', newBlock, '', '#### answer', '', quote(r.newText), '')
  }
  return out.join('\n')
}

const quote = (text) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
