import { app } from 'electron'
import pkg from 'electron-updater'

const { autoUpdater } = pkg

export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err)
  })

  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] update downloaded; will install on quit')
  })

  void autoUpdater.checkForUpdatesAndNotify()
  setInterval(
    () => {
      void autoUpdater.checkForUpdatesAndNotify()
    },
    4 * 60 * 60 * 1000
  )
}
