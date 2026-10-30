// Offline readability bench for the overlay's answer pane.
//
//   electron scripts/bench/overlay-readability.mjs --out <built out/ dir> --label <name>
//   node scripts/bench/overlay-readability.mjs --compare <labelA> <labelB>
//
// Loads <out>/renderer/overlay.html in an offscreen window sized like the real
// overlay, feeds it a fake window.zanban (bench-preload.cjs), streams a fixed
// answer, paints a stand-in desktop behind it and scores the captured pixels.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scoreCase } from './metrics.mjs'
import { BACKGROUNDS, paintBackground } from './backgrounds.mjs'
import { probe } from './probe.mjs'
import { SCENARIOS } from './scenarios.mjs'
import { compareMarkdown, summarize, toMarkdown } from './report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const DEFAULT_ROOT =
  'C:\\Users\\alcar\\AppData\\Local\\Temp\\claude\\C--Users-alcar-OneDrive--------------zanban\\d41d8355-6109-4506-950e-de14d324a735\\scratchpad\\overlay-bench'

// Window geometry: the real overlay is 720 wide and grows to its content, capped
// by the work area (assumed 1040 high) minus its top margin (12) and bottom margin (24).
const WIDTH = 720
const MAX_HEIGHT = 1004
const MIN_HEIGHT = 120

function parseArgs(argv) {
  const args = { out: './out', label: null, dest: null, mid: false, only: null, patch: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--label') args.label = argv[++i]
    else if (a === '--dest') args.dest = argv[++i]
    else if (a === '--only') args.only = argv[++i]
    else if (a === '--settings-patch') args.patch = JSON.parse(argv[++i])
    else if (a === '--mid') args.mid = true
    else if (a === '--compare') args.compare = [argv[++i], argv[++i]]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const root = args.dest ?? process.env.ZANBAN_BENCH_DIR ?? DEFAULT_ROOT

function loadResults(ref) {
  const file = existsSync(ref)
    ? ref.endsWith('.json')
      ? ref
      : join(ref, 'results.json')
    : join(root, ref, 'results.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

if (args.compare) {
  const [a, b] = args.compare.map(loadResults)
  process.stdout.write(compareMarkdown(a, b))
  process.exit(0)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function loadElectron() {
  const mod = await import('electron')
  const api = mod.app ? mod : mod.default
  if (!api?.app) throw new Error('Run this with the repo Electron binary: pnpm bench:overlay')
  return api
}

async function main() {
  const label = args.label ?? 'build'
  const outDir = resolve(args.out)
  const overlayHtml = join(outDir, 'renderer', 'overlay.html')
  if (!existsSync(overlayHtml))
    throw new Error(`No renderer build at ${overlayHtml}. Run pnpm build.`)
  const dest = join(root, label)
  mkdirSync(dest, { recursive: true })

  const { app, BrowserWindow } = await loadElectron()
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  app.disableHardwareAcceleration()
  app.on('window-all-closed', () => {})
  await app.whenReady()

  const { DEFAULT_SETTINGS } = await import(
    pathToFileURL(join(repoRoot, 'src', 'shared', 'types.ts')).href
  )

  const evalIn = (win, code) => win.webContents.executeJavaScript(code, true)
  const settle = (win) =>
    evalIn(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')

  async function capture(win, height) {
    await settle(win)
    await wait(150)
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height })
    const size = img.getSize()
    const raw = img.toBitmap()
    if (size.width !== WIDTH || size.height !== height || raw.length !== WIDTH * height * 4) {
      throw new Error(`Unexpected capture ${size.width}x${size.height} for ${WIDTH}x${height}`)
    }
    const data = new Uint8ClampedArray(raw.length)
    for (let i = 0; i < raw.length; i += 4) {
      data[i] = raw[i + 2]
      data[i + 1] = raw[i + 1]
      data[i + 2] = raw[i]
      data[i + 3] = 255
    }
    return { bitmap: { width: WIDTH, height, data }, png: img.toPNG() }
  }

  const bgCache = new Map()
  async function setBackground(win, kind) {
    let css
    if (kind === 'flat') css = 'html{background:#808080 !important}'
    else {
      if (!bgCache.has(kind)) {
        const code = `(${paintBackground.toString()})(${JSON.stringify(kind)}, ${WIDTH}, ${MAX_HEIGHT})`
        bgCache.set(kind, await evalIn(win, code))
      }
      css = `html{background:url(${bgCache.get(kind)}) 0 0 / ${WIDTH}px ${MAX_HEIGHT}px no-repeat !important}`
    }
    css +=
      '*,*::before,*::after{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}'
    await evalIn(
      win,
      `(() => {
        let s = document.getElementById('bench-bg')
        if (!s) { s = document.createElement('style'); s.id = 'bench-bg'; document.head.appendChild(s) }
        s.textContent = ${JSON.stringify(css)}
      })()`
    )
    await wait(200)
  }

  async function waitFor(win, expr, what, timeout = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await evalIn(win, expr)) return
      await wait(100)
    }
    throw new Error(`Timed out waiting for ${what}`)
  }

  async function runScenario(sc) {
    const settings = {
      ...DEFAULT_SETTINGS,
      vercelApiKey: 'bench-key',
      uiLocale: sc.uiLocale,
      ...(args.patch ?? {})
    }
    const config = Buffer.from(JSON.stringify({ settings }), 'utf8').toString('base64')
    const win = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: MAX_HEIGHT,
      useContentSize: true,
      frame: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: false,
        backgroundThrottling: false,
        preload: join(here, 'bench-preload.cjs'),
        additionalArguments: [`--bench-config=${config}`]
      }
    })
    win.webContents.setFrameRate(30)
    const errors = []
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') errors.push(e.message)
    })
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          await win.loadFile(overlayHtml)
          break
        } catch (err) {
          if (attempt === 3) throw err
          await wait(500)
        }
      }
      await waitFor(win, "window.__bench.has('overlay.onAnswerLast')", 'overlay mount')

      await evalIn(
        win,
        `(() => {
          const b = window.__bench
          b.emit('session.onState', { kind: 'running', sessionId: 'bench', startedAt: Date.now() - 754000 })
          b.emit('transcription.onSegment', {
            id: 's1', channel: 'system', speaker: 1, startMs: 0, endMs: 4000,
            text: ${JSON.stringify(sc.question)}, isFinal: true, createdAt: Date.now()
          })
        })()`
      )
      await wait(900)
      await evalIn(win, "window.__bench.emit('overlay.onAnswerLast')")
      await waitFor(win, 'window.__bench.lastAsk !== null', 'ask dispatch')
      const requestId = await evalIn(win, 'window.__bench.lastAsk.requestId')

      const chunks = sc.markdown.match(/[\s\S]{1,16}/g)
      const batch = 6
      const midAt = Math.floor(chunks.length / batch / 2)
      let midShot = null
      for (let i = 0, n = 0; i < chunks.length; i += batch, n++) {
        const payloads = chunks.slice(i, i + batch).map((text) => ({ requestId, text }))
        await evalIn(win, `window.__bench.emitMany('ai.onChunk', ${JSON.stringify(payloads)})`)
        await wait(16)
        if (args.mid && n === midAt) {
          await setBackground(win, BACKGROUNDS[0])
          const h = await currentHeight(win)
          midShot = (await capture(win, h)).png
        }
      }
      await evalIn(
        win,
        `window.__bench.emit('ai.onDone', ${JSON.stringify({ requestId, finishReason: 'stop' })})`
      )
      await wait(800)

      const probeCode = (h) =>
        `(${probe.toString()})(${JSON.stringify({ firstAnchor: sc.firstAnchor, lastAnchor: sc.lastAnchor, viewportH: h })})`
      let height = await currentHeight(win)
      let result = null
      let lastKey = ''
      for (let i = 0; i < 30; i++) {
        height = await currentHeight(win)
        result = await evalIn(win, probeCode(height))
        const key = result.found ? `${height}:${result.words.length}` : 'none'
        if (result.found && key === lastKey) break
        lastKey = key
        await wait(300)
      }
      if (!result?.found) {
        throw new Error(
          `Answer text not found for ${sc.id}. Page errors: ${errors.slice(0, 3).join(' | ')}`
        )
      }

      await setBackground(win, 'flat')
      const flat = (await capture(win, height)).bitmap

      const cases = []
      for (const bg of BACKGROUNDS) {
        await setBackground(win, bg)
        const withBg = await capture(win, height)
        await evalIn(win, "document.getElementById('root').style.visibility = 'hidden'")
        const bgOnly = (await capture(win, height)).bitmap
        await evalIn(win, "document.getElementById('root').style.visibility = ''")
        const shot = `${sc.id}__${bg}.png`
        writeFileSync(join(dest, shot), withBg.png)
        const metrics = scoreCase(result, { withBg: withBg.bitmap, flat, bgOnly })
        cases.push({
          scenario: sc.id,
          background: bg,
          ...metrics,
          windowHeight: height,
          scrollHeight: result.scroller.scrollHeight,
          verdictText: result.verdict.text,
          screenshot: shot
        })
      }
      if (midShot) writeFileSync(join(dest, `${sc.id}__mid-stream.png`), midShot)
      return cases
    } finally {
      win.destroy()
      await wait(300)
    }
  }

  async function currentHeight(win) {
    const requested = await evalIn(win, 'window.__bench.height')
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(requested) || 520))
  }

  const scenarios = SCENARIOS.filter((s) => !args.only || s.id === args.only)
  const cases = []
  for (const sc of scenarios) {
    process.stdout.write(`scenario ${sc.id}\n`)
    cases.push(...(await runScenario(sc)))
  }

  const results = {
    label,
    out: outDir,
    createdAt: new Date().toISOString(),
    window: { width: WIDTH, height: MAX_HEIGHT },
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    cases,
    summary: summarize(cases)
  }
  writeFileSync(join(dest, 'results.json'), JSON.stringify(results, null, 2))
  writeFileSync(join(dest, 'results.md'), toMarkdown(results))
  process.stdout.write(`${toMarkdown(results)}\nWrote ${dest}\n`)
}

// No top-level await past this point: Electron holds 'ready' until an ESM main
// entry finishes evaluating, so awaiting app.whenReady() here would deadlock.
main()
  .then(() => 0)
  .catch((err) => {
    process.stderr.write(`${err?.stack ?? err}
`)
    return 1
  })
  .then(async (code) => {
    const api = await loadElectron().catch(() => null)
    process.exitCode = code
    api?.app.exit(code)
  })
