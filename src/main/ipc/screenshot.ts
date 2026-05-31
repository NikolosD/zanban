import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { capturePrimaryDisplay, captureWithOcr, captureInstant } from '../screenshot/index.js'
import type { ScreenSnapshotOcr } from '../../shared/types.js'

export function registerScreenshotHandlers(): void {
  ipcMain.handle(IPC.screenshot.capture, () => capturePrimaryDisplay())
  ipcMain.handle(IPC.screenshot.captureWithOcr, () => captureWithOcr())
  // Instant path (F1/F5): the image returns to the caller immediately; the OCR
  // text is pushed back to the same WebContents on the `ocr` channel once it
  // finishes. We capture the sender here so the result lands in the window that
  // asked, even if focus moved on.
  ipcMain.handle(IPC.screenshot.captureInstant, (e) => {
    const wc: WebContents = e.sender
    return captureInstant((snapshotId, ocrText) => {
      if (!wc.isDestroyed()) {
        const payload: ScreenSnapshotOcr = { snapshotId, ocrText }
        wc.send(IPC.screenshot.ocr, payload)
      }
    })
  })
}
