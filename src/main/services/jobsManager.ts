import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'

export interface BackgroundJob {
  id: string
  title: string
  kind: 'rag' | 'ocr' | 'pull' | 'export' | 'other'
  startedAt: number
}

const jobs = new Map<string, BackgroundJob>()
let windows: BrowserWindow[] = []

export function registerJobsWindow(win: BrowserWindow): void {
  windows.push(win)
  win.on('closed', () => {
    windows = windows.filter((w) => w !== win)
  })
}

function broadcast(): void {
  const list = Array.from(jobs.values()).sort((a, b) => a.startedAt - b.startedAt)
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(IPC.jobs.state, list)
  }
}

export function startJob(id: string, title: string, kind: BackgroundJob['kind'] = 'other'): void {
  jobs.set(id, { id, title, kind, startedAt: Date.now() })
  broadcast()
}

export function endJob(id: string): void {
  if (jobs.delete(id)) broadcast()
}

export function listJobs(): BackgroundJob[] {
  return Array.from(jobs.values())
}

/**
 * Run an async block while reporting it as a background job. Cleans up even
 * if the block throws.
 */
export async function trackJob<T>(
  id: string,
  title: string,
  kind: BackgroundJob['kind'],
  fn: () => Promise<T>
): Promise<T> {
  startJob(id, title, kind)
  try {
    return await fn()
  } finally {
    endJob(id)
  }
}
