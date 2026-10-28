import { MODELS_DIR_ENV, type MlRequest, type MlResponse } from './protocol.js'
import { createMlTasks } from './tasks.js'

const modelsDir = process.env[MODELS_DIR_ENV]
if (!modelsDir) throw new Error(`${MODELS_DIR_ENV} is not set`)
const tasks = createMlTasks(modelsDir)

function reply(response: MlResponse): void {
  process.parentPort.postMessage(response)
}

process.parentPort.on('message', ({ data }) => {
  const request = data as MlRequest
  tasks
    .run(request, (progress) => reply({ id: request.id, progress }))
    .then(
      (result) => reply({ id: request.id, ok: true, result }),
      (err: unknown) =>
        reply({
          id: request.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
    )
})
