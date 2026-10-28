import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAppUrl } from '../security.js'

function fromAppPage(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url
  return url !== undefined && isAppUrl(url)
}

/** `ipcMain.handle` that rejects calls from any frame that isn't one of our pages. */
export function handleIpc<A extends unknown[]>(
  channel: string,
  listener: (e: IpcMainInvokeEvent, ...args: A) => unknown
): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromAppPage(e)) throw new Error(`IPC ${channel} rejected: sender is not an app page`)
    return listener(e, ...(args as A))
  })
}

/** `ipcMain.on` that drops messages from any frame that isn't one of our pages. */
export function onIpc<A extends unknown[]>(
  channel: string,
  listener: (e: IpcMainEvent, ...args: A) => void
): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromAppPage(e)) listener(e, ...(args as A))
  })
}
