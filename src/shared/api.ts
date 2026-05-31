import type {
  AiAskInput,
  AiChunk,
  AiDone,
  AiError,
  AiSources,
  AppSettings,
  AudioChannel,
  LlmProvider,
  Persona,
  ReferenceDoc,
  ScreenSnapshot,
  ScreenSnapshotOcr,
  SessionExportPayload,
  SessionState,
  TranscriptSegment,
  TranscriptionStatus
} from './types.js'
import type { GlobalActionItem, RecapOptions, RecapPayload, RecapResult } from './recap-types.js'

export interface SessionListItem {
  id: string
  startedAt: number
  endedAt: number | null
  title: string | null
  durationMs: number | null
}

export interface StoredSegment {
  channel: AudioChannel
  startMs: number
  text: string
}

export interface StoredExchange {
  prompt: string
  answer: string
  model: string | null
  createdAt: number
}

export interface SessionDetailPayload {
  id: string
  startedAt: number
  endedAt: number | null
  title: string | null
  segments: StoredSegment[]
  exchanges: StoredExchange[]
  filePath: string
}

export interface ZanbanApi {
  getVersion(): Promise<string>
  /** Reveal the app log file in the OS file manager. Returns the path (or null
   *  if the logs dir couldn't be resolved). */
  revealLog(): Promise<string | null>
  /** Environment info for the About → "copy environment info" button. */
  getEnvInfo(): Promise<EnvInfo>
  /** Open a URL in the OS default handler (mailto:, http:, https: only).
   *  Returns false if the scheme is rejected or the URL is malformed. */
  openExternal(url: string): Promise<boolean>
  overlay: {
    show(): Promise<void>
    hide(): Promise<void>
    toggle(): Promise<void>
    setIgnoreMouse(ignore: boolean): Promise<void>
    setContentHeight(height: number): Promise<void>
    onFocusAsk(cb: () => void): () => void
    onAnswerLast(cb: () => void): () => void
    onSnapshotAsk(cb: (snap: ScreenSnapshot) => void): () => void
    /** Main → overlay: capture happened AND should be answered immediately
     *  (screenshotAnswer hotkey). */
    onSnapshotAnswer(cb: (snap: ScreenSnapshot) => void): () => void
    getStealth(): Promise<boolean>
    setStealth(on: boolean): Promise<boolean>
    onStealthChanged(cb: (stealth: boolean) => void): () => void
  }
  dashboard: {
    show(): Promise<void>
    /** Main → dashboard: open the Settings dialog (fired by the tray). */
    onOpenSettings(cb: () => void): () => void
    /** Main → dashboard: start a session through the renderer capture pipeline
     *  (fired by the tray's Start action). */
    onRequestStartSession(cb: () => void): () => void
    /** Main → dashboard: stop the active session (fired by the tray). */
    onRequestStopSession(cb: () => void): () => void
  }
  updater: {
    /** Trigger a manual update check. No-op in dev (returns false). */
    check(): Promise<boolean>
    /** Restart and install a downloaded update. */
    quitAndInstall(): Promise<void>
    /** An update finished downloading and is ready to apply on restart. */
    onDownloaded(cb: (info: UpdateInfo) => void): () => void
    /** A check/download failed. */
    onError(cb: (message: string) => void): () => void
    /** Status pulses for the manual "Check for updates" button. */
    onStatus(cb: (status: UpdateStatus) => void): () => void
  }
  session: {
    start(input?: { resumeId?: string }): Promise<{ sessionId: string }>
    stop(): Promise<void>
    onState(cb: (state: SessionState) => void): () => void
  }
  audio: {
    sendChunk(channel: AudioChannel, buffer: ArrayBuffer): void
  }
  transcription: {
    onSegment(cb: (segment: TranscriptSegment) => void): () => void
    onStatus(cb: (status: TranscriptionStatus) => void): () => void
  }
  ai: {
    ask(input: AiAskInput): Promise<{ requestId: string }>
    /** Abort an in-flight ask() by id. Main finalizes the partial answer
     *  cleanly (emits `done`, no error). No-op if already finished. */
    stop(requestId: string): Promise<void>
    /** Suggest up to 3 short follow-up questions for a completed Q+A turn.
     *  Returns [] on LLM/parse failure. */
    followUps(question: string, answer: string): Promise<string[]>
    onChunk(cb: (chunk: AiChunk) => void): () => void
    onDone(cb: (done: AiDone) => void): () => void
    onError(cb: (err: AiError) => void): () => void
    /** RAG fragments retrieved for an ask (Sources affordance). Fires once per
     *  ask, before the answer streams; an empty list means nothing retrieved. */
    onSources(cb: (sources: AiSources) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    /**
     * Subscribe to settings changes broadcast from main. Fires after every
     * successful `set()` from any window — lets the overlay keep its store
     * in sync when the user tweaks something in the dashboard.
     */
    onChanged(cb: (settings: AppSettings) => void): () => void
    /**
     * Subscribe to hotkey-registration failures. Fires after a rebind when one
     * or more accelerators couldn't bind (taken by another app / malformed) so
     * the UI can flag the offending binding.
     */
    onHotkeyConflict(cb: (failed: HotkeyConflict[]) => void): () => void
  }
  sessions: {
    list(): Promise<SessionListItem[]>
    read(id: string): Promise<SessionDetailPayload | null>
    revealFolder(): Promise<void>
    /** Permanently delete the .json + .md files for a session id. */
    delete(id: string): Promise<{ ok: boolean }>
    /** Reveal the session's .md file in the OS file manager. */
    revealFile(id: string): Promise<void>
    /** Prompt a save-as dialog for the session's markdown export; returns the chosen path or null on cancel. */
    exportMarkdown(id: string): Promise<string | null>
    /** Rename a session on disk (json + md). Empty/whitespace title clears the
     *  override and falls back to the generated/default. Returns the resolved
     *  title (null when cleared). */
    rename(id: string, title: string): Promise<{ ok: boolean; title: string | null }>
  }
  screenshot: {
    capture(): Promise<string | null>
    captureWithOcr(): Promise<ScreenSnapshot | null>
    /** Instant capture of the active display. Returns the image at once with
     *  `ocrText: null`; subscribe via `onOcr` to receive the OCR text keyed by
     *  the same `snapshotId` once it finishes in the background. */
    captureInstant(): Promise<ScreenSnapshot | null>
    /** Subscribe to background-OCR results for instant snapshots. */
    onOcr(cb: (result: ScreenSnapshotOcr) => void): () => void
  }
  documents: {
    list(): Promise<ReferenceDoc[]>
    upload(filePaths: string[]): Promise<Array<ReferenceDoc | { error: string; path: string }>>
    remove(id: string): Promise<ReferenceDoc[]>
    setActive(id: string, active: boolean): Promise<ReferenceDoc[]>
    exportSessionPdf(payload: SessionExportPayload): Promise<string | null>
    getPathForFile(file: File): string
  }
  rag: {
    search(query: string, k?: number): Promise<RagHit[]>
    deleteSession(sessionId: string): Promise<number>
    count(): Promise<number>
  }
  personas: {
    list(): Promise<Persona[]>
    create(input: Omit<Persona, 'id' | 'builtin' | 'createdAt'>): Promise<Persona>
    update(id: string, patch: Partial<Persona>): Promise<Persona | null>
    delete(id: string): Promise<boolean>
    importJson(json: string): Promise<{ added: number; skipped: number }>
    exportJson(ids?: string[]): Promise<string>
  }
  providers: {
    /** Real connectivity probe for an LLM provider — a cheap live call that
     *  validates auth/routing, unlike the config-presence dot. */
    testConnection(id: LlmProvider): Promise<ProviderTestResult>
  }
  ollama: {
    health(): Promise<OllamaHealth>
    pull(name: string): Promise<boolean>
  }
  cropper: {
    open(): Promise<void>
    /** Submit the dragged selection. `dpr` is the cropper window's
     *  devicePixelRatio at selection time, used by main to reconcile the
     *  CSS-px rect against the captured image's scaleFactor. */
    submit(rect: { x: number; y: number; w: number; h: number; dpr: number }): Promise<void>
    cancel(): Promise<void>
  }
  jobs: {
    onState(cb: (jobs: BackgroundJob[]) => void): () => void
  }
  recap: {
    generate(sessionId: string, options?: RecapOptions): Promise<RecapResult>
    get(sessionId: string): Promise<RecapPayload | null>
    delete(sessionId: string): Promise<void>
    onUpdated(cb: (sessionId: string) => void): () => void
    /** Aggregate "owner: you" action items across every session's recap, newest
     *  session first. Renderer filters out items the user has ticked off. */
    listActionItems(): Promise<GlobalActionItem[]>
  }
}

/** A single hotkey that failed to register, surfaced to the KeyRecorder UI. */
export interface HotkeyConflict {
  action: keyof AppSettings['hotkeys']
  accelerator: string
}

/** Payload for an `update-downloaded` event surfaced to the renderer. */
export interface UpdateInfo {
  version: string
}

/** Coarse status pulses for the manual update-check button. */
export type UpdateStatus =
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading' }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'dev-disabled' }

/** Environment snapshot for bug reports (About tab "copy" button). */
export interface EnvInfo {
  appVersion: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
  v8: string
  osRelease: string
}

export interface BackgroundJob {
  id: string
  title: string
  kind: 'rag' | 'ocr' | 'pull' | 'export' | 'other'
  startedAt: number
}

export interface OllamaHealth {
  running: boolean
  host: string
  models: string[]
  error?: string
}

export interface ProviderTestResult {
  ok: boolean
  message?: string
}

export interface RagHit {
  id: number
  /** What this chunk came from. */
  sourceKind: 'session' | 'doc' | 'recap'
  /** Session id (session/recap) or document id (doc). */
  sourceId: string
  /** Doc filename for docs; null for sessions/recaps. */
  sourceLabel: string | null
  speaker: string | null
  ts: number
  text: string
  distance: number
}
