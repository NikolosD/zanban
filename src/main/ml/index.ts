import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { MODELS_DIR_ENV } from './protocol.js'
import { MlWorkerClient, type MlWorkerProcess } from './workerClient.js'

const IDLE_KILL_MS = 5 * 60_000
const RESTART_DELAYS_MS = [1_000, 5_000, 15_000, 30_000]

function forkWorker(serviceName: string, logTag: string): MlWorkerProcess {
  // The app path is the project root in dev and app.asar once packaged, and
  // out/main sits under both; import.meta.url would name whichever chunk this
  // module was bundled into.
  const child = utilityProcess.fork(join(app.getAppPath(), 'out', 'main', 'mlWorker.js'), [], {
    serviceName,
    // A packaged app has no console; stderr goes through the main logger so a
    // worker that fails to start leaves its reason in the log file.
    stdio: ['ignore', 'inherit', 'pipe'],
    env: { ...process.env, [MODELS_DIR_ENV]: join(app.getPath('userData'), 'models') }
  })
  if (child.stderr) {
    createInterface({ input: child.stderr }).on('line', (line) => {
      // onnxruntime prints a few hundred graph-optimizer warnings per model load.
      if (line && !line.includes('[W:onnxruntime:')) console.warn(`[${logTag}] ${line}`)
    })
  }
  return child
}

/**
 * The utility process that runs Whisper, the embedder and PDF/DOCX extraction.
 * onnxruntime-node inference is synchronous, so on the main thread every batch
 * froze IPC, hotkeys and token streaming for its full duration.
 */
export const mlWorker = new MlWorkerClient({
  fork: () => forkWorker('Zanban ML', 'ml-worker'),
  idleMs: IDLE_KILL_MS,
  restartDelaysMs: RESTART_DELAYS_MS
})

/**
 * Runs Parakeet, and nothing else, in a process of its own. sherpa-onnx ships a
 * newer onnxruntime than @xenova/transformers, and on Windows both bind to
 * whichever onnxruntime.dll loaded first — after Whisper or the embedder,
 * sherpa fails with "version 28 is not supported".
 */
export const speechWorker = new MlWorkerClient({
  fork: () => forkWorker('Zanban Speech', 'speech-worker'),
  idleMs: IDLE_KILL_MS,
  restartDelaysMs: RESTART_DELAYS_MS
})
