import { app } from 'electron'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpeechModelStatus } from '../../shared/api.js'
import { speechWorker } from '../ml/index.js'
import { PARAKEET_DIR, PARAKEET_FILES } from '../ml/models.js'
import { trackJob } from '../services/jobsManager.js'

// The first run downloads ~670 MB.
const LOAD_TIMEOUT_MS = 30 * 60_000

/** Whether the on-device speech model is on disk, and how much is left to download. */
export async function speechModelStatus(): Promise<SpeechModelStatus> {
  const dir = join(app.getPath('userData'), 'models', PARAKEET_DIR)
  const missing = await Promise.all(
    PARAKEET_FILES.map((file) =>
      access(join(dir, file.name)).then(
        () => 0,
        () => file.bytes
      )
    )
  )
  const missingBytes = missing.reduce((sum, bytes) => sum + bytes, 0)
  return { installed: missingBytes === 0, missingBytes }
}

/**
 * Downloads the on-device speech model if it isn't there yet and loads it in
 * the speech process. A session start and the Settings button share the one
 * load there, so they never download the same files twice.
 */
export function loadSpeechModel(onProgress: (fraction: number) => void): Promise<void> {
  return trackJob('parakeet-load', 'Parakeet · loading speech model', 'pull', () =>
    speechWorker.request({ kind: 'load', model: 'parakeet' }, LOAD_TIMEOUT_MS, onProgress)
  )
}
