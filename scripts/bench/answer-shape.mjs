import { mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import Anthropic from '@anthropic-ai/sdk'
import { RUBRICS } from './answer-rubrics.mjs'
import {
  JUDGE_SYSTEM,
  POWERSHELL_KEY_HINT,
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROMPTS_PATH = 'src/main/ai/prompts.ts'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const HELP = `Usage: pnpm bench:answers [options]

Compares the system prompt at --old-ref with the one at --new-ref, scores shape,
rubric coverage (LLM judge, blinded A/B) and speakability.

Options:
  --old-ref <git ref>     prompt baseline (default 45e29c9)
  --new-ref <git ref>     prompt under test (default: working tree)
  --model <id>            answering model (env BENCH_MODEL)
  --judge-model <id>      judge model (default: same as --model)
  --max-tokens <n>        per answer (default 1024)
  --dry-run               print the plan and cost estimate, send nothing
  --yes                   skip the confirmation prompt
  --help                  this text

The key is read only from ANTHROPIC_API_KEY.
${POWERSHELL_KEY_HINT}
`

if (flag('--help') || flag('-h')) {
  console.log(HELP)
  process.exit(0)
}

const oldRef = option('--old-ref', '45e29c9')
const newRef = option('--new-ref', null)
const model = option('--model', process.env.BENCH_MODEL ?? 'claude-sonnet-5-5')
const judgeModel = option('--judge-model', model)
const judgeMaxTokens = 800
const judgeExpectedOut = 220
const maxTokens = Number(option('--max-tokens', '1024'))
const usdPerMtokIn = Number(process.env.BENCH_USD_PER_MTOK_IN ?? 3)
const usdPerMtokOut = Number(process.env.BENCH_USD_PER_MTOK_OUT ?? 15)
const expectedOutTokens = { coding: 450, control: 250, conceptual: 200 }

const CODING = [
  'Given an array of integers and a target, return the indices of the two numbers that add up to the target.',
  'Write a function that checks whether a string of brackets ()[]{} is balanced.',
  'Merge two sorted linked lists into one sorted list.',
  'Реализуй LRU-кэш с операциями get и put за O(1).',
  'Найди самую длинную подстроку без повторяющихся символов.',
  'Given a binary tree, return its level-order traversal as a list of lists.',
  'Напиши функцию debounce на JavaScript.',
  'Find the k-th largest element in an unsorted array.'
]

const CONTROLS = [
  'Tell me about a time you disagreed with your manager.',
  'Расскажи о своём самом сложном проекте.',
  'What is the difference between TCP and UDP?',
  'Why do you want to work at our company?'
]

const CONCEPTUAL = [
  'Какие правила работы с ключами и для чего их ещё используют?',
  'Explain how the event loop works in JavaScript.',
  'Чем useMemo отличается от useCallback и когда их стоит применять?',
  'What are the trade-offs between SQL and NoSQL databases?'
]

const CASES = [
  ...CODING.map((prompt) => ({ prompt, kind: 'coding' })),
  ...CONTROLS.map((prompt) => ({ prompt, kind: 'control' })),
  ...CONCEPTUAL.map((prompt) => ({ prompt, kind: 'conceptual' }))
]

const REFERENCE_DOC_MARKERS = [
  /[—–-]\s*это(?![\p{L}])/giu,
  /используют(?![\p{L}])/giu,
  /используется(?![\p{L}])/giu,
  /^\W*(?:Правила|Rules)\s*:/gimu,
  /\bis used (?:to|for)\b/gi,
  /\bare used (?:to|for)\b/gi,
  /\brefers to\b/gi,
  /^#{1,6}\s/gm
]
const FIRST_PERSON = [
  /(?<![\p{L}])(?:я|мне|меня|мой|моя|моё|мои|мы|нам)(?![\p{L}])/giu,
  /\b(?:I|I'd|I'll|I've|I'm)\b/g,
  /\b(?:my|me|we|our)\b/gi
]
const count = (text, patterns) => patterns.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0)

async function loadPrompts(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

function userMessage(mod, prompt) {
  return mod.buildUserPrompt({
    userPrompt: prompt,
    meetingContext: '',
    segments: [],
    contextSeconds: 60
  })
}

function speakability(lines) {
  const prose = []
  let inCode = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (!inCode && line.trim() !== '') prose.push(line)
  }
  const text = prose.join('\n')
  const sentences = text
    .replace(/^\s*(?:[-*•—]|\d+\.)\s+/gm, '')
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((x) => x.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0)
  const hasLead = /^\*\*(.+?)\*\*/.test(prose[0]?.trim() ?? '')
  const codeSpans = (text.match(/`[^`\n]+`/g) ?? []).length
  return {
    avgSentence: sentences.length ? sentences.reduce((a, b) => a + b, 0) / sentences.length : 0,
    maxSentence: Math.max(0, ...sentences),
    docMarkers: count(text, REFERENCE_DOC_MARKERS) + (codeSpans > 2 ? 1 : 0),
    firstPerson: count(text, FIRST_PERSON),
    linesAfterLead: hasLead ? prose.length - 1 : prose.length
  }
}

function measure(text, ttftMs) {
  const lines = text.split('\n')
  const firstIdx = lines.findIndex((l) => l.trim() !== '')
  const bold = firstIdx >= 0 ? lines[firstIdx].trim().match(/^\*\*(.+?)\*\*/) : null
  const leadWords = bold ? bold[1].trim().split(/\s+/).length : 0
  const fence = lines.findIndex((l) => l.trim().startsWith('```'))
  let codeLines = 0
  let inCode = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) codeLines += 1
  }
  return {
    leadOk: bold !== null && leadWords <= 15,
    linesBeforeCode:
      fence >= 0 ? lines.slice(0, fence).filter((l) => l.trim() !== '').length : null,
    words: text.split(/\s+/).filter(Boolean).length,
    codeLines,
    ...speakability(lines),
    ttftMs
  }
}

async function run(client, system, user) {
  const start = performance.now()
  let ttft = null
  let text = ''
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  })
  stream.on('text', (delta) => {
    if (ttft === null) ttft = performance.now() - start
    text += delta
  })
  await stream.finalMessage()
  return { text, m: measure(text, ttft ?? 0) }
}

async function judge(client, c, answers) {
  const order = pickOrder()
  const reply = await client.messages.create({
    model: judgeModel,
    max_tokens: judgeMaxTokens,
    system: JUDGE_SYSTEM,
    messages: [
      { role: 'user', content: buildJudgePrompt(c.prompt, RUBRICS[c.prompt], answers, order) }
    ]
  })
  const text = reply.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return unblind(parseJudge(text, RUBRICS[c.prompt].length), order)
}

const estimateTokens = (s) => Math.ceil(s.length / 4)

function plan(variants) {
  let inTokens = 0
  let requests = 0
  let outExpected = 0
  let judgeIn = 0
  let judgeRequests = 0
  for (const c of CASES) {
    for (const v of variants) {
      outExpected += expectedOutTokens[c.kind]
      inTokens += estimateTokens(v.system) + estimateTokens(userMessage(v.mod, c.prompt))
      requests += 1
    }
    const rubricTokens = estimateTokens(RUBRICS[c.prompt].map((pt) => pt.text).join(' '))
    judgeIn +=
      estimateTokens(JUDGE_SYSTEM) +
      estimateTokens(c.prompt) +
      rubricTokens +
      2 * expectedOutTokens[c.kind]
    judgeRequests += 1
  }
  const usd = (inTok, out) => (inTok * usdPerMtokIn + out * usdPerMtokOut) / 1_000_000
  const gen = { expected: usd(inTokens, outExpected), max: usd(inTokens, requests * maxTokens) }
  const jdg = {
    expected: usd(judgeIn, judgeRequests * judgeExpectedOut),
    max: usd(judgeIn, judgeRequests * judgeMaxTokens)
  }
  return {
    requests,
    judgeRequests,
    inTokens,
    judgeIn,
    gen,
    jdg,
    usdExpected: gen.expected + jdg.expected,
    usdMax: gen.max + jdg.max
  }
}

const fmt = (v) => (v === null ? '-' : String(v))
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const KINDS = ['coding', 'control', 'conceptual']

function flatten(cases) {
  return cases.flatMap((c) =>
    ['old', 'new'].map((variant) => ({
      prompt: c.prompt,
      kind: c.kind,
      variant,
      m: variant === 'old' ? c.oldM : c.newM,
      auto: variant === 'old' ? c.oldAuto : c.newAuto,
      j: c.judge ? c.judge[variant] : null
    }))
  )
}

function tableLines(rows) {
  const head = [
    'prompt',
    'kind',
    'variant',
    'lead<=15',
    'lines->code',
    'words',
    'code',
    'avg sent',
    'max sent',
    'doc marks',
    '1st person',
    'after lead',
    'cov% judge',
    'cov% kw',
    'fact err',
    'speech',
    'ttft ms'
  ]
  const body = rows.map((r) => [
    r.prompt.slice(0, 34),
    r.kind,
    r.variant,
    r.m.leadOk ? 'yes' : 'no',
    fmt(r.m.linesBeforeCode),
    String(r.m.words),
    String(r.m.codeLines),
    r.m.avgSentence.toFixed(1),
    String(r.m.maxSentence),
    String(r.m.docMarkers),
    String(r.m.firstPerson),
    String(r.m.linesAfterLead),
    r.j ? coveragePct(r.j.covered).toFixed(0) : '-',
    coveragePct(r.auto).toFixed(0),
    r.j ? (r.j.factualError ? 'YES' : 'no') : '-',
    r.j ? String(r.j.speech) : '-',
    String(Math.round(r.m.ttftMs))
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)]
}

function summaryLines(cases) {
  const rows = flatten(cases)
  const out = ['Averages']
  for (const kind of KINDS) {
    for (const variant of ['old', 'new']) {
      const sel = rows.filter((r) => r.kind === kind && r.variant === variant)
      const judged = sel.filter((r) => r.j)
      const lead = sel.filter((r) => r.m.leadOk).length
      const before = sel.map((r) => r.m.linesBeforeCode).filter((v) => v !== null)
      out.push(
        `${kind.padEnd(10)} ${variant}  lead ok ${lead}/${sel.length}` +
          `  lines before code ${avg(before).toFixed(1)}` +
          `  words ${avg(sel.map((r) => r.m.words)).toFixed(0)}` +
          `  code lines ${avg(sel.map((r) => r.m.codeLines)).toFixed(0)}` +
          `  avg sent ${avg(sel.map((r) => r.m.avgSentence)).toFixed(1)}` +
          `  max sent ${avg(sel.map((r) => r.m.maxSentence)).toFixed(1)}` +
          `  doc marks ${avg(sel.map((r) => r.m.docMarkers)).toFixed(1)}` +
          `  1st person ${avg(sel.map((r) => r.m.firstPerson)).toFixed(1)}` +
          `  after lead ${avg(sel.map((r) => r.m.linesAfterLead)).toFixed(1)}` +
          `  cov judge ${avg(judged.map((r) => coveragePct(r.j.covered))).toFixed(0)}%` +
          `  cov kw ${avg(sel.map((r) => coveragePct(r.auto))).toFixed(0)}%` +
          `  fact err ${judged.filter((r) => r.j.factualError).length}` +
          `  speech ${avg(judged.map((r) => r.j.speech)).toFixed(2)}` +
          `  ttft ${avg(sel.map((r) => r.m.ttftMs)).toFixed(0)} ms`
      )
    }
  }
  const wins = { old: 0, new: 0, tie: 0 }
  for (const c of cases) if (c.judge) wins[c.judge.preference] += 1
  out.push('', `Judge preference: old ${wins.old}, new ${wins.new}, tie ${wins.tie}`)
  const failed = cases.filter((c) => c.judgeError).length
  if (failed) out.push(`Judge failed on ${failed} case(s): verdicts exclude them`)
  out.push('', 'Verdict')
  for (const kind of KINDS) {
    out.push(...verdictLines(kind, verdictForKind(cases.filter((c) => c.kind === kind))))
  }
  return out
}

function saveReport(cases, lines, meta) {
  const dir = join(root, 'bench-results')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `answers-${stamp}.md`)
  writeFileSync(file, renderMarkdown({ meta, rows: cases, summaryLines: lines }))
  return file
}

async function main() {
  for (const c of CASES) {
    const n = RUBRICS[c.prompt]?.length ?? 0
    if (n < 3 || n > 5) throw new Error(`Rubric for "${c.prompt}" needs 3-5 points, has ${n}`)
  }
  const oldSource = loadSourceAtRef(oldRef, PROMPTS_PATH, { root })
  const newSource = loadSourceAtRef(newRef, PROMPTS_PATH, { root })
  const variants = [
    { name: 'old', mod: await loadPrompts(oldSource) },
    { name: 'new', mod: await loadPrompts(newSource) }
  ].map((v) => ({ ...v, system: v.mod.buildSystemPrompt() }))

  const p = plan(variants)
  const sourceLine = `old prompt from ${oldRef}, new prompt from ${newRef ?? 'working tree'}`
  const total = p.requests + p.judgeRequests
  console.log(`Model: ${model}  judge: ${judgeModel}  (${sourceLine})`)
  console.log(
    `Cases: ${CODING.length} coding + ${CONTROLS.length} control + ${CONCEPTUAL.length} conceptual, x2 variants + 1 judge call each`
  )
  console.log(
    `Requests: ${total} (${p.requests} answers + ${p.judgeRequests} judge)  est. input tokens: ${p.inTokens + p.judgeIn}`
  )
  console.log(
    `Est. cost: ~$${p.usdExpected.toFixed(2)} expected, $${p.usdMax.toFixed(2)} ceiling ` +
      `(answers ~$${p.gen.expected.toFixed(2)}, judge ~$${p.jdg.expected.toFixed(2)}; ` +
      `at $${usdPerMtokIn}/$${usdPerMtokOut} per Mtok in/out; override with BENCH_USD_PER_MTOK_IN/OUT)`
  )

  if (flag('--dry-run')) {
    console.log('\nDry run: no requests sent.')
    return
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(`Set ANTHROPIC_API_KEY in the environment.\n${POWERSHELL_KEY_HINT}`)
    process.exit(1)
  }
  if (!flag('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('Send these requests? [y/N] ')
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Aborted. Pass --yes to skip this prompt.')
      return
    }
  }

  const client = new Anthropic({ apiKey: key })
  const cases = []
  let done = 0
  const progress = (what, c) => {
    done += 1
    console.log(`${done}/${total} ${what} [${c.kind}] ${c.prompt.slice(0, 50)}`)
  }
  for (const c of CASES) {
    const points = RUBRICS[c.prompt]
    const result = { ...c, points }
    for (const v of variants) {
      const r = await run(client, v.system, userMessage(v.mod, c.prompt))
      result[`${v.name}Text`] = r.text
      result[`${v.name}M`] = r.m
      result[`${v.name}Auto`] = autoCoverage(r.text, points)
      progress(v.name, c)
    }
    try {
      result.judge = await judge(client, c, { old: result.oldText, new: result.newText })
    } catch (err) {
      result.judgeError = err instanceof Error ? err.message : String(err)
      console.error(`Judge failed: ${result.judgeError}`)
    }
    progress('judge', c)
    cases.push(result)
  }
  console.log()
  const lines = summaryLines(cases)
  for (const l of tableLines(flatten(cases))) console.log(l)
  console.log()
  for (const l of lines) console.log(l)
  const file = saveReport(cases, lines, [
    `Model: ${model}, judge: ${judgeModel}`,
    sourceLine,
    `Run: ${new Date().toISOString()}`
  ])
  console.log(`\nSaved: ${file}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
