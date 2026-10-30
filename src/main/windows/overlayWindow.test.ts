import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-channels.js'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = { send: vi.fn(), on: vi.fn() }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setContentProtection = vi.fn()
    setSkipTaskbar = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    isDestroyed(): boolean {
      return this.destroyed
    }
  }
  return {
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
  }
})
vi.mock('../appIcon.js', () => ({ getAppIcon: () => undefined }))
vi.mock('../security.js', () => ({ DEV_SERVER_URL: undefined }))

const { createOverlayWindow } = await import('./overlayWindow.js')

function overlay() {
  return createOverlayWindow() as unknown as {
    emit(event: string): boolean
    destroyed: boolean
    webContents: { send: ReturnType<typeof vi.fn> }
  }
}

describe('createOverlayWindow', () => {
  it('tells the overlay renderer when the window is shown and hidden', () => {
    const win = overlay()

    win.emit('show')
    expect(win.webContents.send).toHaveBeenLastCalledWith(IPC.overlay.visibilityChanged, true)
    win.emit('hide')
    expect(win.webContents.send).toHaveBeenLastCalledWith(IPC.overlay.visibilityChanged, false)
    expect(win.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('stays quiet once the window is gone', () => {
    const win = overlay()
    win.destroyed = true

    expect(() => win.emit('hide')).not.toThrow()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
