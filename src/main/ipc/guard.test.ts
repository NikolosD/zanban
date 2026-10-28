import { beforeEach, describe, expect, it, vi } from 'vitest'

type Registered = (e: unknown, ...args: unknown[]) => unknown

const h = vi.hoisted(() => ({
  handlers: new Map<string, Registered>(),
  listeners: new Map<string, Registered>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Registered) => h.handlers.set(channel, fn),
    on: (channel: string, fn: Registered) => h.listeners.set(channel, fn)
  }
}))

vi.mock('../security.js', () => ({
  isAppUrl: (url: string) => url.startsWith('file:///app/out/renderer/')
}))

const { handleIpc, onIpc } = await import('./guard.js')

const fromApp = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }
const fromWeb = { senderFrame: { url: 'https://evil.example/' } }
const detached = { senderFrame: null }

describe('handleIpc', () => {
  beforeEach(() => h.handlers.clear())

  it('passes calls from app pages through with their arguments', async () => {
    const listener = vi.fn((_e: unknown, a: number, b: number) => a + b)
    handleIpc('sum', listener)
    expect(await h.handlers.get('sum')!(fromApp, 2, 3)).toBe(5)
  })

  it('rejects calls from other origins and detached frames', () => {
    const listener = vi.fn()
    handleIpc('secret', listener)
    expect(() => h.handlers.get('secret')!(fromWeb)).toThrow(/not an app page/)
    expect(() => h.handlers.get('secret')!(detached)).toThrow(/not an app page/)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('onIpc', () => {
  beforeEach(() => h.listeners.clear())

  it('drops messages that do not come from app pages', () => {
    const listener = vi.fn()
    onIpc('chunk', listener)
    h.listeners.get('chunk')!(fromWeb, 'x')
    h.listeners.get('chunk')!(detached, 'x')
    expect(listener).not.toHaveBeenCalled()
    h.listeners.get('chunk')!(fromApp, 'x')
    expect(listener).toHaveBeenCalledWith(fromApp, 'x')
  })
})
