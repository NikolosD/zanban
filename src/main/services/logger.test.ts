import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const logsDir = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => logsDir.value }
}))

const { installLogger, getLogFilePath } = await import('./logger.js')

type Listener = (...args: unknown[]) => void

const PROCESS_EVENTS = ['exit', 'uncaughtException', 'unhandledRejection']
const proc: NodeJS.EventEmitter = process

describe('logger', () => {
  let file = ''
  let installed: Array<{ event: string; listener: Listener }> = []

  beforeAll(() => {
    logsDir.value = mkdtempSync(join(tmpdir(), 'zanban-logger-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = new Set(PROCESS_EVENTS.flatMap((e) => proc.listeners(e)))
    installLogger()
    installed = PROCESS_EVENTS.flatMap((event) =>
      proc
        .listeners(event)
        .filter((l) => !before.has(l))
        .map((l) => ({ event, listener: l as Listener }))
    )
    file = getLogFilePath() ?? ''
  })

  afterAll(() => {
    for (const { event, listener } of installed) proc.removeListener(event, listener)
    vi.restoreAllMocks()
    rmSync(logsDir.value, { recursive: true, force: true })
  })

  it('buffers console output and appends it asynchronously', async () => {
    console.error('first', new Error('boom'))
    console.warn({ a: 1 })
    expect(existsSync(file)).toBe(false)
    await vi.waitFor(() => {
      const text = readFileSync(file, 'utf8')
      expect(text).toMatch(/\[ERROR\] first Error: boom/)
      expect(text).toContain('[WARN] {"a":1}')
    })
  })

  it('rotates the file once it reaches 10 MB', async () => {
    writeFileSync(file, 'x'.repeat(10 * 1024 * 1024))
    console.log('after rotation')
    await vi.waitFor(() => {
      expect(readFileSync(file, 'utf8')).toMatch(/^\S+ \[LOG\] after rotation\n$/)
    })
    expect(readFileSync(file + '.1', 'utf8')).toHaveLength(10 * 1024 * 1024)
  })

  it('writes pending lines synchronously on exit', () => {
    rmSync(file, { force: true })
    console.log('last words')
    for (const { event, listener } of installed) if (event === 'exit') listener(0)
    expect(readFileSync(file, 'utf8')).toContain('[LOG] last words')
  })
})
