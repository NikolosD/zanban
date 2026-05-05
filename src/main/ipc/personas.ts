import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  createPersona,
  deletePersona,
  exportPersonas,
  importPersonas,
  listPersonas,
  updatePersona
} from '../personas/store.js'
import type { Persona } from '../../shared/types.js'

export function registerPersonasHandlers(): void {
  ipcMain.handle(IPC.personas.list, () => listPersonas())
  ipcMain.handle(IPC.personas.create, (_e, input: Omit<Persona, 'id' | 'builtin' | 'createdAt'>) =>
    createPersona(input)
  )
  ipcMain.handle(IPC.personas.update, (_e, id: string, patch: Partial<Persona>) =>
    updatePersona(id, patch)
  )
  ipcMain.handle(IPC.personas.delete, (_e, id: string) => deletePersona(id))
  ipcMain.handle(IPC.personas.importJson, (_e, json: string) => importPersonas(json))
  ipcMain.handle(IPC.personas.exportJson, (_e, ids?: string[]) => exportPersonas(ids))
}
