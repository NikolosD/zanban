import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels.js'
import {
  createPersona,
  deletePersona,
  exportPersonas,
  importPersonas,
  listPersonas,
  updatePersona
} from '../personas/store.js'
import { handleIpc } from './guard.js'
import { importedPersonaSchema, personaInputSchema, personaPatchSchema } from './schemas.js'

export function registerPersonasHandlers(): void {
  handleIpc(IPC.personas.list, () => listPersonas())
  handleIpc(IPC.personas.create, (_e, input: unknown) =>
    createPersona(personaInputSchema.parse(input))
  )
  handleIpc(IPC.personas.update, (_e, id: unknown, patch: unknown) =>
    updatePersona(z.string().parse(id), personaPatchSchema.parse(patch))
  )
  handleIpc(IPC.personas.delete, (_e, id: string) => deletePersona(id))
  handleIpc(IPC.personas.importJson, (_e, json: unknown) => {
    const data: unknown = JSON.parse(z.string().parse(json))
    if (!Array.isArray(data)) throw new Error('Expected an array of personas')
    // A mistyped entry becomes null, which the importer counts as skipped.
    const entries = data.map((entry) => importedPersonaSchema.safeParse(entry).data ?? null)
    return importPersonas(JSON.stringify(entries))
  })
  handleIpc(IPC.personas.exportJson, (_e, ids?: string[]) => exportPersonas(ids))
}
