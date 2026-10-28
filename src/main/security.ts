import { app, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** electron-vite's dev server. Never honoured in a packaged build, where an
 *  inherited env var could otherwise point every window at a remote page. */
export const DEV_SERVER_URL = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL

const RENDERER_FILE_URL = pathToFileURL(join(app.getAppPath(), 'out', 'renderer', '/')).href

export function isAppUrl(url: string): boolean {
  if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return true
  return url.startsWith(RENDERER_FILE_URL)
}

// Only hand off URLs the renderer should legitimately need to open. Guards
// against a compromised renderer asking the OS to launch arbitrary protocol
// handlers (file:, custom app schemes, etc.).
const OPEN_EXTERNAL_SCHEMES = new Set(['mailto:', 'http:', 'https:'])

export async function safeOpenExternal(url: string): Promise<boolean> {
  let scheme: string
  try {
    scheme = new URL(url).protocol
  } catch {
    return false
  }
  if (!OPEN_EXTERNAL_SCHEMES.has(scheme)) return false
  await shell.openExternal(url)
  return true
}

/**
 * Keep every window on the app's own pages: links from LLM answers or a
 * dropped URL would otherwise load a remote page with the full preload bridge
 * and the auto-granted mic / screen permissions. Allowed links go to the OS
 * browser instead.
 */
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    void safeOpenExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
}
