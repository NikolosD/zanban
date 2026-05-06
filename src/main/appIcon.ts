import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

/**
 * Resolve the bundled app-icon PNG, regardless of dev vs packaged layout.
 *
 * - Dev: resources/ sits next to the project root.
 * - Packaged: electron-builder copies resources/ → process.resourcesPath.
 *
 * Cached after first lookup so repeated BrowserWindow creations don't pay
 * the disk read.
 */
let cached: NativeImage | null = null

export function getAppIcon(): NativeImage {
  if (cached) return cached
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  cached = nativeImage.createFromPath(file)
  return cached
}
