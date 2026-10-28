import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import { appendFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024

// During a live call main logs dozens of lines per second. Batching them and
// writing off the main thread keeps console calls from blocking IPC + audio.
const FLUSH_INTERVAL_MS = 500

let logFilePath: string | null = null
let pending: string[] = []
let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

function getLogFile(): string | null {
  if (logFilePath) return logFilePath
  try {
    // app.getPath('logs') resolves to:
    //   macOS: ~/Library/Logs/<App>/
    //   Windows: %APPDATA%\<App>\logs\
    //   Linux: ~/.config/<App>/logs/
    logFilePath = join(app.getPath('logs'), 'zanban.log')
    return logFilePath
  } catch {
    return null
  }
}

async function rotate(file: string): Promise<void> {
  const st = await stat(file).catch(() => null)
  if (!st || st.size < LOG_MAX_BYTES) return
  const rolled = file + '.1'
  await rm(rolled, { force: true })
  await rename(file, rolled)
}

async function flush(): Promise<void> {
  if (flushing || !logFilePath || pending.length === 0) return
  const file = logFilePath
  const batch = pending.join('')
  pending = []
  flushing = true
  try {
    await rotate(file)
    await appendFile(file, batch)
  } catch {
    /* logging must never throw */
  } finally {
    flushing = false
    if (pending.length > 0) scheduleFlush()
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
  flushTimer.unref()
}

// Last-chance write when the process is going down and async I/O may never
// complete. A batch already handed to an in-flight async flush isn't re-sent.
function flushSync(): void {
  if (!logFilePath || pending.length === 0) return
  const batch = pending.join('')
  pending = []
  try {
    appendFileSync(logFilePath, batch)
  } catch {
    /* logging must never throw */
  }
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

function write(level: string, args: unknown[]): void {
  try {
    if (!getLogFile()) return
    pending.push(`${new Date().toISOString()} [${level}] ${format(args)}\n`)
    scheduleFlush()
  } catch {
    /* logging must never throw */
  }
}

let installed = false

export function installLogger(): void {
  if (installed) return
  installed = true

  // Avoid EIO crashes when terminal is detached (packaged app).
  process.stdout?.on?.('error', () => {})
  process.stderr?.on?.('error', () => {})

  const origLog = console.log.bind(console)
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)

  console.log = (...args: unknown[]): void => {
    origLog(...args)
    write('LOG', args)
  }
  console.warn = (...args: unknown[]): void => {
    origWarn(...args)
    write('WARN', args)
  }
  console.error = (...args: unknown[]): void => {
    origError(...args)
    write('ERROR', args)
  }

  process.on('uncaughtException', (err) => {
    write('FATAL', ['uncaughtException', err])
    flushSync()
  })
  process.on('unhandledRejection', (reason) => {
    write('FATAL', ['unhandledRejection', reason])
    flushSync()
  })
  process.on('exit', flushSync)
}

export function getLogFilePath(): string | null {
  return getLogFile()
}
