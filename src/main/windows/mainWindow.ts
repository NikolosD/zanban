import { BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !!process.env.ELECTRON_RENDERER_URL

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '',
    backgroundColor: '#0b0b0d',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      // Dashboard captures mic/system audio. When the session is running we
      // hide the dashboard window — without this flag, Chromium throttles its
      // timers/AudioWorklet and the live transcript stalls.
      backgroundThrottling: false
    }
  })

  // Default to content-protected so the dashboard is also invisible to
  // screen-share / recording — same stealth posture as the overlay. main/index.ts
  // later wires this to the live `stealthOn` cache and reapplies on every
  // show() (Windows quirk: setContentProtection can race the HWND on first show).
  win.setContentProtection(true)

  win.once('ready-to-show', () => {
    win.show()
    if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  })

  // Prevent the renderer's <title> from re-populating the native title bar.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win.setTitle('')
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', details)
  })
  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error('[main] preload-error', preloadPath, err)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
