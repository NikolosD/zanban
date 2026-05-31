import { BrowserWindow } from 'electron'
import type { Display } from 'electron'
import { join } from 'node:path'
import { getActiveDisplay } from '../screenshot/index.js'

/**
 * Open the transparent fullscreen drag-surface for the region cropper.
 *
 * By default it covers the display **under the cursor** so the drag UI lines up
 * with the same screen that capture + crop target (F2) — on a second monitor
 * the primary-display window would otherwise never appear where the user is
 * looking. The caller may pass an explicit display to pin it elsewhere; main
 * passes the active one so the window bounds, the captured background image,
 * and the crop coordinates all refer to a single display (no primary-vs-active
 * mismatch in the rect math).
 */
export function createCropperWindow(display: Display = getActiveDisplay()): BrowserWindow {
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
