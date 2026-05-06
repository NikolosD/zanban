import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import type { ZanbanApi } from '../shared/api.js'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler as never)
  return () => ipcRenderer.off(channel, handler as never)
}

const api: ZanbanApi = {
  getVersion: () => ipcRenderer.invoke(IPC.app.getVersion),
  overlay: {
    show: () => ipcRenderer.invoke(IPC.overlay.show),
    hide: () => ipcRenderer.invoke(IPC.overlay.hide),
    toggle: () => ipcRenderer.invoke(IPC.overlay.toggle),
    setIgnoreMouse: (ignore) => ipcRenderer.invoke(IPC.overlay.setIgnoreMouse, ignore),
    setContentHeight: (height) => ipcRenderer.invoke(IPC.overlay.setContentHeight, height),
    onFocusAsk: (cb) => on(IPC.overlay.focusAsk, () => cb()),
    onAnswerLast: (cb) => on(IPC.overlay.answerLast, () => cb()),
    onSnapshotAsk: (cb) => on(IPC.overlay.snapshotAsk, cb),
    getStealth: () => ipcRenderer.invoke(IPC.overlay.getStealth),
    setStealth: (on) => ipcRenderer.invoke(IPC.overlay.setStealth, on),
    onStealthChanged: (cb) => on<boolean>(IPC.overlay.stealthChanged, (v) => cb(v))
  },
  dashboard: {
    show: () => ipcRenderer.invoke(IPC.dashboard.show)
  },
  session: {
    start: (input) => ipcRenderer.invoke(IPC.session.start, input),
    stop: () => ipcRenderer.invoke(IPC.session.stop),
    onState: (cb) => on(IPC.session.state, cb)
  },
  audio: {
    sendChunk: (channel, buffer) => {
      ipcRenderer.send(IPC.audio.chunk, channel, buffer)
    }
  },
  transcription: {
    onSegment: (cb) => on(IPC.transcription.segment, cb),
    onStatus: (cb) => on(IPC.transcription.status, cb)
  },
  ai: {
    ask: (input) => ipcRenderer.invoke(IPC.ai.ask, input),
    onChunk: (cb) => on(IPC.ai.chunk, cb),
    onDone: (cb) => on(IPC.ai.done, cb),
    onError: (cb) => on(IPC.ai.error, cb),
    extractQuestion: (text) => ipcRenderer.invoke(IPC.ai.extractQuestion, text)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    set: (patch) => ipcRenderer.invoke(IPC.settings.set, patch),
    onChanged: (cb) => on(IPC.settings.changed, cb)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.sessions.list),
    read: (id) => ipcRenderer.invoke(IPC.sessions.read, id),
    revealFolder: () => ipcRenderer.invoke(IPC.sessions.revealFolder),
    delete: (id) => ipcRenderer.invoke(IPC.sessions.delete, id),
    revealFile: (id) => ipcRenderer.invoke(IPC.sessions.revealFile, id),
    exportMarkdown: (id) => ipcRenderer.invoke(IPC.sessions.exportMarkdown, id)
  },
  screenshot: {
    capture: () => ipcRenderer.invoke(IPC.screenshot.capture),
    captureWithOcr: () => ipcRenderer.invoke(IPC.screenshot.captureWithOcr)
  },
  documents: {
    list: () => ipcRenderer.invoke(IPC.documents.list),
    upload: (filePaths) => ipcRenderer.invoke(IPC.documents.upload, filePaths),
    remove: (id) => ipcRenderer.invoke(IPC.documents.remove, id),
    setActive: (id, active) => ipcRenderer.invoke(IPC.documents.setActive, id, active),
    exportSessionPdf: (payload) => ipcRenderer.invoke(IPC.documents.exportSessionPdf, payload),
    // Electron 32 removed `File.path`. The renderer now hands File objects to
    // this bridge to recover the absolute path that the main-process upload
    // handler expects.
    getPathForFile: (file) => webUtils.getPathForFile(file)
  },
  rag: {
    search: (query, k) => ipcRenderer.invoke(IPC.rag.search, query, k),
    deleteSession: (sessionId) => ipcRenderer.invoke(IPC.rag.deleteSession, sessionId),
    count: () => ipcRenderer.invoke(IPC.rag.count)
  },
  personas: {
    list: () => ipcRenderer.invoke(IPC.personas.list),
    create: (input) => ipcRenderer.invoke(IPC.personas.create, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.personas.update, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.personas.delete, id),
    importJson: (json) => ipcRenderer.invoke(IPC.personas.importJson, json),
    exportJson: (ids) => ipcRenderer.invoke(IPC.personas.exportJson, ids)
  },
  ollama: {
    health: () => ipcRenderer.invoke(IPC.ollama.health),
    pull: (name) => ipcRenderer.invoke(IPC.ollama.pull, name)
  },
  cropper: {
    open: () => ipcRenderer.invoke(IPC.cropper.open),
    submit: (rect) => ipcRenderer.invoke(IPC.cropper.submit, rect),
    cancel: () => ipcRenderer.invoke(IPC.cropper.cancel)
  },
  jobs: {
    onState: (cb) => on(IPC.jobs.state, cb)
  }
}

contextBridge.exposeInMainWorld('zanban', api)
