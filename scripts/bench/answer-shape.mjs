import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import Anthropic from '@anthropic-ai/sdk'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROMPTS_PATH = 'src/main/ai/prompts.ts'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const oldRef = option('--old-ref', 'b7527c7')
const model = option('--model', process.env.BENCH_MODEL ?? 'claude-sonnet-5-5')
const maxTokens = Number(option('--max-tokens', '1024'))
const usdPerMtokIn = Number(process.env.BENCH_USD_PER_MTOK_IN ?? 3)
const usdPerMtokOut = Number(process.env.BENCH_USD_PER_MTOK_OUT ?? 15)
const expectedOutTokens = 450

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

const CASES = [
  ...CODING.map((prompt) => ({ prompt, kind: 'coding' })),
  ...CONTROLS.map((prompt) => ({ prompt, kind: 'control' }))
]

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
  return measure(text, ttft ?? 0)
}

const estimateTokens = (s) => Math.ceil(s.length / 4)

function plan(variants) {
  let inTokens = 0
  let requests = 0
  for (const v of variants) {
    for (const c of CASES) {
      inTokens += estimateTokens(v.system) + estimateTokens(userMessage(v.mod, c.prompt))
      requests += 1
    }
  }
  const usd = (out) => (inTokens * usdPerMtokIn + out * usdPerMtokOut) / 1_000_000
  return {
    requests,
    inTokens,
    usdExpected: usd(requests * expectedOutTokens),
    usdMax: usd(requests * maxTokens)
  }
}

const fmt = (v) => (v === null ? '-' : String(v))

function printTable(rows) {
  const head = ['prompt', 'kind', 'variant', 'lead<=15', 'lines->code', 'words', 'code', 'ttft ms']
  const body = rows.map((r) => [
    r.prompt.slice(0, 34),
    r.kind,
    r.variant,
    r.m.leadOk ? 'yes' : 'no',
    fmt(r.m.linesBeforeCode),
    String(r.m.words),
    String(r.m.codeLines),
    String(Math.round(r.m.ttftMs))
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(line(head))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const b of body) console.log(line(b))
}

function printSummary(rows) {
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  console.log('\nAverages')
  for (const kind of ['coding', 'control']) {
    for (const variant of ['old', 'new']) {
      const sel = rows.filter((r) => r.kind === kind && r.variant === variant)
      const lead = sel.filter((r) => r.m.leadOk).length
      const before = sel.map((r) => r.m.linesBeforeCode).filter((v) => v !== null)
      console.log(
        `${kind.padEnd(8)} ${variant}  lead ok ${lead}/${sel.length}` +
          `  lines before code ${avg(before).toFixed(1)}` +
          `  words ${avg(sel.map((r) => r.m.words)).toFixed(0)}` +
          `  code lines ${avg(sel.map((r) => r.m.codeLines)).toFixed(0)}` +
          `  ttft ${avg(sel.map((r) => r.m.ttftMs)).toFixed(0)} ms`
      )
    }
  }
}

async function main() {
  const oldSource = execFileSync('git', ['show', `${oldRef}:${PROMPTS_PATH}`], {
    cwd: root,
    encoding: 'utf8'
  })
  const newSource = readFileSync(join(root, PROMPTS_PATH), 'utf8')
  const variants = [
    { name: 'old', mod: await loadPrompts(oldSource) },
    { name: 'new', mod: await loadPrompts(newSource) }
  ].map((v) => ({ ...v, system: v.mod.buildSystemPrompt() }))

  const p = plan(variants)
  console.log(`Model: ${model}  (old prompt from ${oldRef}, new prompt from working tree)`)
  console.log(`Cases: ${CODING.length} coding + ${CONTROLS.length} control, x2 variants`)
  console.log(`Requests: ${p.requests}  est. input tokens: ${p.inTokens}`)
  console.log(
    `Est. cost: ~$${p.usdExpected.toFixed(2)} expected, $${p.usdMax.toFixed(2)} ceiling ` +
      `(at $${usdPerMtokIn}/$${usdPerMtokOut} per Mtok in/out; override with BENCH_USD_PER_MTOK_IN/OUT)`
  )

  if (flag('--dry-run')) {
    console.log('\nDry run: no requests sent.')
    return
  }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('Set ANTHROPIC_API_KEY in the environment.')
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
  const rows = []
  for (const c of CASES) {
    for (const v of variants) {
      rows.push({
        ...c,
        variant: v.name,
        m: await run(client, v.system, userMessage(v.mod, c.prompt))
      })
    }
  }
  console.log()
  printTable(rows)
  printSummary(rows)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
