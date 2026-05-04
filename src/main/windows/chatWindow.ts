import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    title: 'Zanban Chat',
    backgroundColor: '#0e0e10',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'darwin',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chat.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/chat.html'))
  }

  return win
}
