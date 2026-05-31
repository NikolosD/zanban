import { app, ipcMain, type BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import { IPC } from '../../shared/ipc-channels.js'
import type { UpdateInfo, UpdateStatus } from '../../shared/api.js'

const { autoUpdater } = pkg

type WindowGetter = () => BrowserWindow | null

let getWindow: WindowGetter = () => null

function send<T>(channel: string, payload: T): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function sendStatus(status: UpdateStatus): void {
  send(IPC.updater.status, status)
}

/**
 * Wire the auto-updater. In packaged builds it downloads updates in the
 * background and, once ready, surfaces a "Restart to update" toast in the
 * dashboard instead of silently waiting for the next quit. The renderer
 * decides when to apply via `updater:quit-and-install`.
 *
 * @param window getter for the dashboard window to forward events to.
 */
export function initAutoUpdate(window: WindowGetter = () => null): void {
  getWindow = window

  // IPC is registered regardless of packaging so the renderer's
  // "Check for updates" button has a handler in dev too (it replies
  // dev-disabled rather than throwing).
  ipcMain.handle(IPC.updater.check, async (): Promise<boolean> => {
    if (!app.isPackaged) {
      sendStatus({ kind: 'dev-disabled' })
      return false
    }
    try {
      sendStatus({ kind: 'checking' })
      const result = await autoUpdater.checkForUpdates()
      // checkForUpdates resolves with null when no update channel is reachable.
      // If an update is available electron-updater auto-downloads (autoDownload
      // stays true) and the 'update-downloaded' event drives the toast; if not,
      // report up-to-date so the button can settle.
      const info = result?.updateInfo
      if (!info || info.version === app.getVersion()) {
        sendStatus({ kind: 'up-to-date' })
      } else {
        sendStatus({ kind: 'downloading' })
      }
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendStatus({ kind: 'error', message })
      return false
    }
  })

  ipcMain.handle(IPC.updater.quitAndInstall, () => {
    if (!app.isPackaged) return
    // isSilent=false shows the installer UI; isForceRunAfter=true relaunches
    // the app once the update is applied.
    autoUpdater.quitAndInstall(false, true)
  })

  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[updater] error', err)
    send(IPC.updater.error, message)
    sendStatus({ kind: 'error', message })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const version = (info as { version?: string }).version ?? ''
    console.log('[updater] update downloaded; ready to install', version)
    const payload: UpdateInfo = { version }
    send(IPC.updater.downloaded, payload)
    sendStatus({ kind: 'downloaded', version })
  })

  void autoUpdater.checkForUpdatesAndNotify()
  setInterval(
    () => {
      void autoUpdater.checkForUpdatesAndNotify()
    },
    4 * 60 * 60 * 1000
  )
}
