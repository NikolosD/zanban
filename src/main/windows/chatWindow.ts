import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { getAppIcon } from '../appIcon.js'

/**
 * The chat window shows AI answers, so it needs the same screen-share
 * blackout as the overlay/dashboard — otherwise a recorder would capture
 * the answers even though the rest of the app is hidden. `stealthOn` seeds
 * the initial content-protection; main/index.ts re-applies it on every show
 * (Windows quirk: setContentProtection can race the HWND on first show).
 */
export function createChatWindow(stealthOn = true): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    title: 'Zanban Chat',
    icon: getAppIcon(),
    backgroundColor: '#0e0e10',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'darwin',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      // The chat window streams answers; without this Chromium throttles its
      // timers when the window is backgrounded and the stream stalls — same
      // reason the overlay/dashboard set it.
      backgroundThrottling: false
    }
  })

  // Default to content-protected so the chat (with AI answers) is also
  // invisible to screen-share / recording — same stealth posture as overlay
  // and dashboard.
  win.setContentProtection(stealthOn)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/chat.html'))
  }

  return win
}
