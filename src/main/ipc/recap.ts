import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc-channels.js'
import { isValidSessionId, readSessionFromDisk } from '../sync/sessionSync.js'
import { getSettings } from '../settings.js'
import { generateRecap as llmGenerateRecap } from '../ai/llm/recapLlm.js'
import { createRecapService, type RecapService } from '../services/recap/recapService.js'
import type { RecapOptions } from '../services/recap/recapSchema.js'

let service: RecapService | null = null
let registered = false

function broadcast(sessionId: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.recap.updated, sessionId)
  }
}

export function getRecapService(): RecapService {
  if (!service) {
    service = createRecapService({
      dir: join(app.getPath('userData'), 'sessions'),
      readSession: async (id) => (isValidSessionId(id) ? readSessionFromDisk(id) : null),
      llm: (session, options) => {
        const settings = getSettings()
        const merged: RecapOptions = {
          tone: options.tone ?? settings.recap.tone,
          language: options.language ?? settings.recap.language,
          modelOverride: options.modelOverride ?? settings.recap.modelOverride
        }
        return llmGenerateRecap(session, merged)
      },
      onUpdated: broadcast
    })
  }
  return service
}

export function registerRecapHandlers(): void {
  if (registered) return
  registered = true
  const svc = getRecapService()

  ipcMain.handle(IPC.recap.generate, async (_e, sessionId: unknown, options?: unknown) => {
    if (!isValidSessionId(sessionId)) {
      return { ok: false, code: 'no_transcript', message: 'Invalid session id.' }
    }
    return svc.generate(sessionId, (options ?? {}) as RecapOptions)
  })

  ipcMain.handle(IPC.recap.get, async (_e, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) return null
    return svc.get(sessionId)
  })

  ipcMain.handle(IPC.recap.delete, async (_e, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) return
    await svc.delete(sessionId)
  })

  ipcMain.handle(IPC.recap.listActionItems, () => svc.listMyActionItems())
}
