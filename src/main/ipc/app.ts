import { app, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { getLogFilePath } from '../services/logger.js'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.app.revealLog, () => {
    const p = getLogFilePath()
    if (p) shell.showItemInFolder(p)
    return p
  })
}
