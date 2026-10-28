import os from 'node:os'
import { app, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import type { EnvInfo } from '../../shared/api.js'
import { getLogFilePath } from '../services/logger.js'
import { safeOpenExternal } from '../security.js'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.app.revealLog, () => {
    const p = getLogFilePath()
    if (p) shell.showItemInFolder(p)
    return p
  })
  // Diagnostics snapshot for the About tab's "copy environment info" button —
  // exactly the fields a maintainer needs in a bug report.
  ipcMain.handle(IPC.app.getEnvInfo, (): EnvInfo => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      v8: process.versions.v8 ?? '',
      osRelease: `${os.type()} ${os.release()}`
    }
  })
  ipcMain.handle(IPC.app.openExternal, (_e, url: unknown) =>
    typeof url === 'string' ? safeOpenExternal(url) : false
  )
}
