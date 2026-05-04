import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !!process.env.ELECTRON_RENDERER_URL

export function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width: sw } = display.workAreaSize
  const w = 720
  const h = 520
  const margin = 12

  const win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.max(0, Math.floor((sw - w) / 2)),
    y: margin,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(true)

  win.once('ready-to-show', () => {
    // Overlay stays hidden on startup — it is shown only when a session starts.
    // Note: do NOT auto-open detached devtools here. A detached devtools window
    // is a sibling top-level window that DOES show up in Alt+Tab / taskbar even
    // though the overlay itself is `skipTaskbar`. Open them manually with
    // Ctrl+Shift+I from the overlay if needed.
  })

  // Re-apply skipTaskbar / alwaysOnTop after every show — on Windows these
  // settings can race with HWND creation on the first show().
  win.on('show', () => {
    win.setSkipTaskbar(true)
    win.setAlwaysOnTop(true, 'screen-saver')
  })

  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error('[overlay] preload-error', preloadPath, err)
  })

  if (isDev) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return win
}
