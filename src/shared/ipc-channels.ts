export const IPC = {
  app: {
    getVersion: 'app:get-version',
    revealLog: 'app:reveal-log',
    openExternal: 'app:open-external',
    /** Environment info for the About → diagnostics "copy" button. */
    getEnvInfo: 'app:get-env-info'
  },
  updater: {
    /** Renderer → main: kick off a manual update check. */
    check: 'updater:check',
    /** Renderer → main: restart the app and apply the downloaded update. */
    quitAndInstall: 'updater:quit-and-install',
    /** Main → renderer: an update finished downloading and is ready to apply. */
    downloaded: 'updater:downloaded',
    /** Main → renderer: a check/download failed. */
    error: 'updater:error',
    /** Main → renderer: status pulses for the "Check for updates" button. */
    status: 'updater:status'
  },
  overlay: {
    show: 'overlay:show',
    hide: 'overlay:hide',
    toggle: 'overlay:toggle',
    setIgnoreMouse: 'overlay:set-ignore-mouse',
    setContentHeight: 'overlay:set-content-height',
    focusAsk: 'overlay:focus-ask',
    answerLast: 'overlay:answer-last',
    snapshotAsk: 'overlay:snapshot-ask',
    getStealth: 'overlay:get-stealth',
    setStealth: 'overlay:set-stealth',
    stealthChanged: 'overlay:stealth-changed'
  },
  dashboard: {
    show: 'dashboard:show',
    /** Main → dashboard: open the Settings dialog (optionally on a tab). */
    openSettings: 'dashboard:open-settings',
    /** Main → dashboard: start a session via the renderer's capture pipeline
     *  (mic/system audio capture runs in the renderer, so the tray can't just
     *  call sessionManager.start directly — it must route through the UI). */
    requestStartSession: 'dashboard:request-start-session',
    /** Main → dashboard: stop the active session + tear down captures. */
    requestStopSession: 'dashboard:request-stop-session'
  },
  session: {
    start: 'session:start',
    stop: 'session:stop',
    state: 'session:state'
  },
  audio: {
    chunk: 'audio:chunk'
  },
  transcription: {
    segment: 'transcription:segment',
    status: 'transcription:status'
  },
  ai: {
    ask: 'ai:ask',
    stop: 'ai:stop',
    followUps: 'ai:follow-ups',
    chunk: 'ai:chunk',
    done: 'ai:done',
    error: 'ai:error',
    /** Main → renderer: RAG fragments retrieved for an ask, for the Sources UI. */
    sources: 'ai:sources'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    changed: 'settings:changed',
    /** Main → renderer: one or more hotkeys failed to (re)register, e.g. the
     *  accelerator is already taken by another app. */
    hotkeyConflict: 'settings:hotkey-conflict'
  },
  sessions: {
    list: 'sessions:list',
    read: 'sessions:read',
    revealFolder: 'sessions:reveal-folder',
    delete: 'sessions:delete',
    revealFile: 'sessions:reveal-file',
    exportMarkdown: 'sessions:export-markdown',
    rename: 'sessions:rename'
  },
  screenshot: {
    capture: 'screenshot:capture',
    captureWithOcr: 'screenshot:capture-with-ocr',
    /** Instant capture of the active display: image returns at once, OCR
     *  follows on the `ocr` event keyed by snapshotId. */
    captureInstant: 'screenshot:capture-instant',
    /** Background-OCR result for a previously delivered instant snapshot. */
    ocr: 'screenshot:ocr'
  },
  documents: {
    upload: 'documents:upload',
    remove: 'documents:remove',
    list: 'documents:list',
    setActive: 'documents:set-active',
    exportSessionPdf: 'documents:export-session-pdf'
  },
  rag: {
    search: 'rag:search',
    deleteSession: 'rag:delete-session',
    count: 'rag:count'
  },
  personas: {
    list: 'personas:list',
    create: 'personas:create',
    update: 'personas:update',
    delete: 'personas:delete',
    importJson: 'personas:import-json',
    exportJson: 'personas:export-json'
  },
  providers: {
    testConnection: 'providers:test-connection'
  },
  ollama: {
    health: 'ollama:health',
    pull: 'ollama:pull'
  },
  cropper: {
    open: 'cropper:open',
    submit: 'cropper:submit',
    cancel: 'cropper:cancel'
  },
  jobs: {
    state: 'jobs:state'
  },
  recap: {
    generate: 'recap:generate',
    get: 'recap:get',
    delete: 'recap:delete',
    updated: 'recap:updated',
    listActionItems: 'recap:list-action-items'
  }
} as const
