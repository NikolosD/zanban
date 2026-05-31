import { app, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { getLogFilePath } from '../services/logger.js'

// Only hand off URLs the renderer should legitimately need to open. Guards
// against a compromised renderer asking the OS to launch arbitrary protocol
// handlers (file:, custom app schemes, etc.).
const OPEN_EXTERNAL_SCHEMES = new Set(['mailto:', 'http:', 'https:'])

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.app.revealLog, () => {
    const p = getLogFilePath()
    if (p) shell.showItemInFolder(p)
    return p
  })
  ipcMain.handle(IPC.app.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string') return false
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      return false
    }
    if (!OPEN_EXTERNAL_SCHEMES.has(scheme)) return false
    await shell.openExternal(url)
    return true
  })
}
