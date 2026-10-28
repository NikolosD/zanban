/** Env var carrying userData/models to the worker, which has no `app` to ask. */
export const MODELS_DIR_ENV = 'ZANBAN_MODELS_DIR'

export type MlModel = 'whisper' | 'embedder' | 'parakeet'

/** One phrase, timed from the start of its speech stream. */
export interface SpeechSegment {
  text: string
  startMs: number
  endMs: number
}

// Typed arrays cross by structured clone: Electron's transfer list only takes
// MessagePortMain, and a send between processes copies the bytes regardless.
export type MlTask =
  | { kind: 'load'; model: MlModel }
  | { kind: 'transcribe'; samples: Float32Array; language?: string; chunkSeconds: number }
  | { kind: 'speechFeed'; stream: string; samples: Float32Array }
  | { kind: 'speechEnd'; stream: string }
  | { kind: 'embed'; texts: string[] }
  | { kind: 'extract'; format: 'pdf' | 'docx'; data: Uint8Array }

export interface MlResults {
  load: void
  transcribe: string
  speechFeed: SpeechSegment[]
  speechEnd: SpeechSegment[]
  embed: Float32Array[]
  extract: string
}

export type MlRequest = MlTask & { id: number }

export type MlResponse =
  | { id: number; ok: true; result: MlResults[MlTask['kind']] }
  | { id: number; ok: false; error: string }
