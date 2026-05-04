import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

export function createCropperWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width, height, x, y } = display.bounds

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Hide from screen-share so the cropper overlay itself isn't recorded.
  win.setContentProtection(true)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/cropper.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/cropper.html'))
  }

  return win
}
