import { app } from 'electron'
import { existsSync, statSync, renameSync, unlinkSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024

let logFilePath: string | null = null

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

function rotate(file: string): void {
  try {
    const st = statSync(file)
    if (st.size < LOG_MAX_BYTES) return
    const rolled = file + '.1'
    if (existsSync(rolled)) unlinkSync(rolled)
    renameSync(file, rolled)
  } catch {
    /* file doesn't exist yet — ignore */
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
  const file = getLogFile()
  if (!file) return
  try {
    rotate(file)
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${format(args)}\n`)
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
  })
  process.on('unhandledRejection', (reason) => {
    write('FATAL', ['unhandledRejection', reason])
  })
}

export function getLogFilePath(): string | null {
  return getLogFile()
}
