export const IPC = {
  app: {
    getVersion: 'app:get-version',
    revealLog: 'app:reveal-log',
    openExternal: 'app:open-external'
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
    show: 'dashboard:show'
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
    error: 'ai:error'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    changed: 'settings:changed'
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
    captureWithOcr: 'screenshot:capture-with-ocr'
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
