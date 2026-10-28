/** Env var carrying userData/models to the worker, which has no `app` to ask. */
export const MODELS_DIR_ENV = 'ZANBAN_MODELS_DIR'

export type MlModel = 'whisper' | 'embedder'

// Typed arrays cross by structured clone: Electron's transfer list only takes
// MessagePortMain, and a send between processes copies the bytes regardless.
export type MlTask =
  | { kind: 'load'; model: MlModel }
  | { kind: 'transcribe'; samples: Float32Array; language?: string; chunkSeconds: number }
  | { kind: 'embed'; texts: string[] }
  | { kind: 'extract'; format: 'pdf' | 'docx'; data: Uint8Array }

export interface MlResults {
  load: void
  transcribe: string
  embed: Float32Array[]
  extract: string
}

export type MlRequest = MlTask & { id: number }

export type MlResponse =
  | { id: number; ok: true; result: MlResults[MlTask['kind']] }
  | { id: number; ok: false; error: string }
