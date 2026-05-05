export const IPC = {
  app: {
    getVersion: 'app:get-version',
    revealLog: 'app:reveal-log'
  },
  overlay: {
    show: 'overlay:show',
    hide: 'overlay:hide',
    toggle: 'overlay:toggle',
    setIgnoreMouse: 'overlay:set-ignore-mouse',
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
    chunk: 'ai:chunk',
    done: 'ai:done',
    error: 'ai:error',
    extractQuestion: 'ai:extract-question'
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
    exportMarkdown: 'sessions:export-markdown'
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
  }
} as const
