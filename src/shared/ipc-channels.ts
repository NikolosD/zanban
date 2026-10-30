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
    setWidth: 'overlay:set-width',
    dragStart: 'overlay:drag-start',
    dragEnd: 'overlay:drag-end',
    focusAsk: 'overlay:focus-ask',
    answerLast: 'overlay:answer-last',
    snapshotAsk: 'overlay:snapshot-ask',
    /** Main → overlay: a screenshot was captured AND should be answered
     *  immediately (the screenshotAnswer hotkey), no manual Ask step. */
    snapshotAnswer: 'overlay:snapshot-answer',
    getStealth: 'overlay:get-stealth',
    setStealth: 'overlay:set-stealth',
    stealthChanged: 'overlay:stealth-changed',
    /** Main → overlay: the window was shown or hidden. */
    visibilityChanged: 'overlay:visibility-changed',
    /** Main → overlay: scroll the answer a page up or down (global hotkey). */
    scrollAnswer: 'overlay:scroll-answer',
    /** Main → overlay: expand the code block in view, or collapse the expanded one. */
    toggleExpandCode: 'overlay:toggle-expand-code',
    /** Renderer → main: grow the window to the display's work-area height, or restore it. */
    setExpanded: 'overlay:set-expanded'
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
    state: 'session:state',
    /** Overlay → main: start or stop via the dashboard capture path, like the
     *  toggleSession hotkey. */
    requestToggle: 'session:request-toggle'
  },
  audio: {
    chunk: 'audio:chunk',
    notice: 'audio:notice'
  },
  transcription: {
    segment: 'transcription:segment',
    status: 'transcription:status',
    speechModel: 'transcription:speech-model',
    downloadSpeechModel: 'transcription:download-speech-model',
    speechModelProgress: 'transcription:speech-model-progress'
  },
  ai: {
    ask: 'ai:ask',
    stop: 'ai:stop',
    followUps: 'ai:follow-ups',
    chunk: 'ai:chunk',
    done: 'ai:done',
    error: 'ai:error',
    /** Main → renderer: RAG fragments retrieved for an ask, for the Sources UI. */
    sources: 'ai:sources',
    /** Main → renderer: a configured gateway model is gone from the catalog and a default answered. */
    modelReplaced: 'ai:model-replaced',
    availableModels: 'ai:available-models'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    changed: 'settings:changed',
    /** Main → renderer: the hotkeys that failed to (re)register after a rebind, e.g. the
     *  accelerator is already taken by another app. Empty once every hotkey is bound. */
    hotkeyConflict: 'settings:hotkey-conflict',
    hotkeyConflicts: 'settings:hotkey-conflicts',
    pickFreeHotkeys: 'settings:pick-free-hotkeys'
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
    testConnection: 'providers:test-connection',
    testStt: 'providers:test-stt'
  },
  ollama: {
    health: 'ollama:health',
    pull: 'ollama:pull',
    pullProgress: 'ollama:pull-progress'
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
