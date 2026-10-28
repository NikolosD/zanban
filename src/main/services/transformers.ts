import { app } from 'electron'
import { join } from 'node:path'

export interface TransformersPipeline {
  dispose(): Promise<void>
}

interface TransformersModule {
  env: { cacheDir: string; allowLocalModels: boolean }
  pipeline(task: string, model: string, opts?: { revision?: string }): Promise<TransformersPipeline>
}

/**
 * @xenova/transformers with its env set for this app. Every model load goes
 * through here: the library's default cache sits next to its own files, which
 * is inside the read-only app.asar once packaged.
 */
export async function loadTransformers(): Promise<TransformersModule> {
  const mod = (await import('@xenova/transformers')) as unknown as TransformersModule
  mod.env.cacheDir = join(app.getPath('userData'), 'models')
  // No weights ship under the library's local model path; probing it costs a
  // failed read and a console warning per file on every cold load.
  mod.env.allowLocalModels = false
  return mod
}
