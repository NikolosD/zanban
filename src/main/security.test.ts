import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  packaged: true,
  appPath: '',
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.packaged
    },
    getAppPath: () => h.appPath
  },
  shell: { openExternal: h.openExternal }
}))

type Security = typeof import('./security.js')

async function load(options: { packaged: boolean; devServer?: string }): Promise<Security> {
  h.packaged = options.packaged
  vi.stubEnv('ELECTRON_RENDERER_URL', options.devServer)
  vi.resetModules()
  return import('./security.js')
}

function rendererPage(file: string): string {
  return pathToFileURL(join(h.appPath, 'out', 'renderer', file)).href
}

beforeEach(() => {
  h.appPath = join(process.cwd(), 'resources', 'app')
  h.openExternal.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAppUrl', () => {
  it('accepts only the app’s own renderer pages in an installed build', async () => {
    const { isAppUrl } = await load({ packaged: true })

    expect(isAppUrl(rendererPage('index.html'))).toBe(true)
    expect(isAppUrl(rendererPage('overlay.html'))).toBe(true)
    expect(isAppUrl(rendererPage('nested/chat.html'))).toBe(true)
  })

  it.each([
    ['another web page', 'https://evil.example/index.html'],
    ['a local file outside the renderer folder', pathToFileURL(join('/', 'tmp', 'x.html')).href],
    ['a sibling folder that merely starts with the same name', '__SIBLING__'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an empty string', '']
  ])('rejects %s', async (_label, url) => {
    const { isAppUrl } = await load({ packaged: true })
    const sibling = pathToFileURL(join(h.appPath, 'out', 'renderer-evil', 'index.html')).href
    expect(isAppUrl(url === '__SIBLING__' ? sibling : url)).toBe(false)
  })

  it('serves pages from the dev server while developing', async () => {
    const { isAppUrl } = await load({ packaged: false, devServer: 'http://localhost:5173' })

    expect(isAppUrl('http://localhost:5173/overlay.html')).toBe(true)
    expect(isAppUrl('http://localhost:9999/overlay.html')).toBe(false)
  })

  it('ignores an inherited dev-server variable in an installed build', async () => {
    const { isAppUrl, DEV_SERVER_URL } = await load({
      packaged: true,
      devServer: 'http://evil.example'
    })

    expect(DEV_SERVER_URL).toBeUndefined()
    expect(isAppUrl('http://evil.example/index.html')).toBe(false)
  })
})

describe('safeOpenExternal', () => {
  it.each([
    'https://zanban.example/docs',
    'http://localhost:11434/api',
    'mailto:support@zanban.example?subject=Привет',
    'HTTPS://EXAMPLE.COM/Path'
  ])('hands %s to the OS browser', async (url) => {
    const { safeOpenExternal } = await load({ packaged: true })

    expect(await safeOpenExternal(url)).toBe(true)
    expect(h.openExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ms-msdt:/id PCWDiagnostic',
    'zanban://do-something',
    'vscode://file/etc/passwd',
    'not a url',
    '',
    '//evil.example/x'
  ])('refuses %j without calling the OS', async (url) => {
    const { safeOpenExternal } = await load({ packaged: true })

    expect(await safeOpenExternal(url)).toBe(false)
    expect(h.openExternal).not.toHaveBeenCalled()
  })
})

describe('hardenWebContents', () => {
  function fakeContents() {
    const handlers: {
      open?: (details: { url: string }) => { action: string }
      navigate?: (e: { preventDefault: () => void }, url: string) => void
    } = {}
    return {
      handlers,
      contents: {
        setWindowOpenHandler: (fn: NonNullable<typeof handlers.open>) => {
          handlers.open = fn
        },
        on: (event: string, fn: NonNullable<typeof handlers.navigate>) => {
          if (event === 'will-navigate') handlers.navigate = fn
        }
      }
    }
  }

  it('never lets a link open a new app window, and sends only safe links to the browser', async () => {
    const { hardenWebContents } = await load({ packaged: true })
    const { contents, handlers } = fakeContents()
    hardenWebContents(contents as never)

    expect(handlers.open!({ url: 'https://zanban.example/docs' })).toEqual({ action: 'deny' })
    expect(handlers.open!({ url: 'file:///C:/secrets.txt' })).toEqual({ action: 'deny' })
    await Promise.resolve()

    expect(h.openExternal).toHaveBeenCalledTimes(1)
    expect(h.openExternal).toHaveBeenCalledWith('https://zanban.example/docs')
  })

  it('blocks navigation away from the app’s pages but allows moving between them', async () => {
    const { hardenWebContents } = await load({ packaged: true })
    const { contents, handlers } = fakeContents()
    hardenWebContents(contents as never)

    const leave = { preventDefault: vi.fn() }
    handlers.navigate!(leave, 'https://evil.example/phish')
    expect(leave.preventDefault).toHaveBeenCalledTimes(1)

    const stay = { preventDefault: vi.fn() }
    handlers.navigate!(stay, rendererPage('index.html'))
    expect(stay.preventDefault).not.toHaveBeenCalled()
  })
})
