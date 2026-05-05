import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { capturePrimaryDisplay, captureWithOcr } from '../screenshot/index.js'

export function registerScreenshotHandlers(): void {
  ipcMain.handle(IPC.screenshot.capture, () => capturePrimaryDisplay())
  ipcMain.handle(IPC.screenshot.captureWithOcr, () => captureWithOcr())
}
