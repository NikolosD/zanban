import { app, type BrowserWindow } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { IPC } from '../../shared/ipc-channels.js'
import { handleIpc } from '../ipc/guard.js'
import type { UpdateInfo, UpdateStatus } from '../../shared/api.js'
import { sessionManager } from '../transcription/sessionManager.js'

const FIRST_CHECK_DELAY_MS = 60_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type WindowGetter = () => BrowserWindow | null

let getWindow: WindowGetter = () => null
let updaterPromise: Promise<AppUpdater> | null = null
let downloadQueued = false
// Background checks fail quietly — offline, or no release published yet — so
// only a check the user asked for reports its error.
let userCheck = false

function send<T>(channel: string, payload: T): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function sendStatus(status: UpdateStatus): void {
  send(IPC.updater.status, status)
}

// Reading `autoUpdater` constructs the platform updater, so both the module and
// the instance stay off the startup path until the first check.
function getUpdater(): Promise<AppUpdater> {
  updaterPromise ??= import('electron-updater').then(({ default: { autoUpdater } }) => {
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[updater] error', err)
      if (!userCheck) return
      send(IPC.updater.error, message)
      sendStatus({ kind: 'error', message })
    })

    autoUpdater.on('update-available', () => {
      if (!autoUpdater.autoDownload) downloadWhenIdle(autoUpdater)
    })

    autoUpdater.on('update-downloaded', (info) => {
      const version = (info as { version?: string }).version ?? ''
      console.log('[updater] update downloaded; ready to install', version)
      const payload: UpdateInfo = { version }
      send(IPC.updater.downloaded, payload)
      sendStatus({ kind: 'downloaded', version })
    })

    return autoUpdater
  })
  return updaterPromise
}

// A download competes with live transcription for bandwidth, so a check made
// during a call only finds the update and the download waits for the call to end.
async function prepareCheck(): Promise<AppUpdater> {
  const updater = await getUpdater()
  updater.autoDownload = sessionManager.getState().kind === 'idle'
  return updater
}

function downloadWhenIdle(updater: AppUpdater): void {
  if (sessionManager.getState().kind === 'idle') {
    // Failures are reported through the updater's 'error' event.
    updater.downloadUpdate().catch(() => {})
    return
  }
  if (downloadQueued) return
  downloadQueued = true
  const off = sessionManager.onState((state) => {
    if (state.kind !== 'idle') return
    off()
    downloadQueued = false
    updater.downloadUpdate().catch(() => {})
  })
}

function backgroundCheck(): void {
  prepareCheck()
    .then((updater) => updater.checkForUpdatesAndNotify())
    .catch((err: unknown) => console.error('[updater] background check failed', err))
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
  handleIpc(IPC.updater.check, async (): Promise<boolean> => {
    if (!app.isPackaged) {
      sendStatus({ kind: 'dev-disabled' })
      return false
    }
    userCheck = true
    try {
      sendStatus({ kind: 'checking' })
      const updater = await prepareCheck()
      const result = await updater.checkForUpdates()
      // checkForUpdates resolves with null when no update channel is reachable.
      // If an update is available it downloads (now, or once the call ends) and
      // the 'update-downloaded' event drives the toast; if not, report
      // up-to-date so the button can settle.
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
    } finally {
      userCheck = false
    }
  })

  handleIpc(IPC.updater.quitAndInstall, async () => {
    if (!app.isPackaged) return
    const updater = await getUpdater()
    // isSilent=false shows the installer UI; isForceRunAfter=true relaunches
    // the app once the update is applied.
    updater.quitAndInstall(false, true)
  })

  if (!app.isPackaged) return
  window()?.once('ready-to-show', () => {
    setTimeout(() => {
      backgroundCheck()
      setInterval(backgroundCheck, CHECK_INTERVAL_MS)
    }, FIRST_CHECK_DELAY_MS)
  })
}
