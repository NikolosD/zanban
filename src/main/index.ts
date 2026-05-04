import 'dotenv/config'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeTheme, screen, session, shell } from 'electron'
import { createMainWindow } from './windows/mainWindow.js'
import { createOverlayWindow } from './windows/overlayWindow.js'
import { IPC } from '../shared/ipc-channels.js'
import { sessionManager } from './transcription/sessionManager.js'
import {
  ask as aiAsk,
  cancel as aiCancel,
  extractQuestion as aiExtractQuestion,
  registerAiWindow
} from './ai/aiGatewayClient.js'
import { getSettings, setSettings } from './settings.js'
import type { AppSettings, AudioChannel } from '../shared/types.js'
import {
  registerSyncWindow,
  listSessionsFromDisk,
  readSessionFromDisk,
  getSessionsDir,
  getSessionMdPath,
  deleteSessionFromDisk,
  copySessionMarkdown
} from './sync/sessionSync.js'
import { capturePrimaryDisplay, captureWithOcr } from './screenshot/index.js'
import { runOcr } from './screenshot/ocrPipeline.js'
import { createCropperWindow } from './windows/cropperWindow.js'
import { createChatWindow } from './windows/chatWindow.js'
import { initAutoUpdate } from './updater/autoUpdate.js'
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js'
import {
  addDoc as addReferenceDoc,
  listDocs as listReferenceDocs,
  removeDoc as removeReferenceDoc,
  setActive as setReferenceDocActive
} from './documents/referenceStore.js'
import { exportSessionPdf } from './documents/pdfExporter.js'
import type { SessionExportPayload } from '../shared/types.js'
import {
  search as ragSearch,
  deleteSession as ragDeleteSession,
  countChunks as ragCountChunks
} from './rag/index.js'
import {
  listPersonas,
  createPersona,
  updatePersona,
  deletePersona,
  importPersonas,
  exportPersonas
} from './personas/store.js'
import type { Persona } from '../shared/types.js'
import { checkOllama, pullModel } from './services/ollamaManager.js'
import { registerJobsWindow } from './services/jobsManager.js'
import { installLogger, getLogFilePath } from './services/logger.js'

installLogger()

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
// Seeded from settings.detectable in app.whenReady() — we cache here so we
// don't have to hit the settings store on every show().
let stealthOn = true
// One-shot escape hatch from stealth+hideWidget mode. The Show Dashboard
// hotkey sets this to true so the dashboard stays in Alt+Tab/taskbar until
// the user starts a new session (which clears it back to settings-driven).
let dashboardForcedVisible = false

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.zanban.app')

  // Force dark window chrome (Windows 11 paints the native title bar dark).
  nativeTheme.themeSource = 'dark'

  // Stealth: optionally hide the macOS dock icon. Has to be called before
  // any window is created — calling it after `dock.show()` is a no-op until
  // the next launch. Linux/Windows: app.dock is undefined.
  if (process.platform === 'darwin' && getSettings().hideDockMacOS) {
    app.dock?.hide()
  }

  // Seed in-memory stealth state from persisted settings.
  stealthOn = !getSettings().detectable

  // Auto-grant microphone / camera / display media — we own this app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = ['media', 'mediaKeySystem', 'display-capture', 'audioCapture', 'videoCapture']
    callback(granted.includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  // System audio capture: bypass picker, give renderer the loopback audio.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )

  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.app.revealLog, () => {
    const p = getLogFilePath()
    if (p) shell.showItemInFolder(p)
    return p
  })

  // Apply the current stealth posture to both windows. setContentProtection
  // is the only mechanism that hides a Chromium window from screen-share —
  // we keep dashboard and overlay in lockstep so toggling Detectable means
  // "neither shows up to a screen-recorder".
  //
  // On Windows the underlying SetWindowDisplayAffinity call is unreliable when
  // applied to a window that's already visible — the user reported having to
  // toggle Detectable twice for capture-protection to actually kick in. The
  // workaround Electron community uses is to set the opposite value first,
  // then schedule the real value on the next tick. Same trick the user was
  // doing by hand, just programmatic.
  function applyStealth(): void {
    for (const w of [overlayWindow, mainWindow]) {
      if (!w || w.isDestroyed()) continue
      if (stealthOn) {
        // Going INVISIBLE: we must never briefly flip to visible — even a
        // single 100ms window is enough for an active screen-recorder to
        // capture frames of the overlay. Just hammer setContentProtection(true)
        // a few times across paint cycles to force Windows to commit it.
        w.setContentProtection(true)
        setTimeout(() => {
          if (!w.isDestroyed()) w.setContentProtection(true)
        }, 100)
        setTimeout(() => {
          if (!w.isDestroyed()) w.setContentProtection(true)
        }, 250)
      } else {
        // Going VISIBLE: the same Windows-quirk where the first call drops
        // applies, but flashing to `true` mid-transition is harmless — the
        // user wants visible anyway, so a brief moment of "still hidden" is
        // invisible to them.
        w.setContentProtection(true)
        setTimeout(() => {
          if (!w.isDestroyed()) w.setContentProtection(false)
        }, 100)
      }
    }
  }

  // When Stealth is engaged AND the user has opted into "Hide widget when
  // hiding", drop the dashboard from the taskbar and Alt+Tab — but keep it
  // on screen so the user can still interact with it. setSkipTaskbar(true)
  // on Windows applies WS_EX_TOOLWINDOW which removes the window from both
  // surfaces. Combined with setContentProtection (screen-share blackout) it's
  // the same posture the overlay already uses.
  function applyDashboardVisibility(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const settings = getSettings()
    const lowProfile =
      stealthOn && settings.hideWidgetWhenHidden && !dashboardForcedVisible
    mainWindow.setSkipTaskbar(lowProfile)
  }

  function applyOverlayOpacity(): void {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const raw = getSettings().overlayOpacity ?? 1
    // Clamp to a useful range — fully transparent overlays are unreachable
    // and 100%+ has no effect. Floor at 0.4 so the user can never lose the
    // window completely from the screen by accident.
    const opacity = Math.min(1, Math.max(0.4, raw))
    overlayWindow.setOpacity(opacity)
  }

  function showOverlay(): void {
    if (!overlayWindow) return
    overlayWindow.show()
    overlayWindow.setContentProtection(stealthOn)
  }
  ipcMain.handle(IPC.overlay.show, () => showOverlay())
  ipcMain.handle(IPC.overlay.hide, () => overlayWindow?.hide())
  ipcMain.handle(IPC.overlay.toggle, () => {
    if (!overlayWindow) return
    if (overlayWindow.isVisible()) overlayWindow.hide()
    else showOverlay()
  })
  ipcMain.handle(IPC.overlay.setIgnoreMouse, (_e, ignore: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })
  ipcMain.handle(IPC.overlay.getStealth, () => stealthOn)
  ipcMain.handle(IPC.overlay.setStealth, (_e, on: boolean) => {
    stealthOn = !!on
    applyStealth()
    applyDashboardVisibility()
    // Persist so the next session honors the user's last choice.
    void setSettings({ detectable: !stealthOn })
    return stealthOn
  })

  ipcMain.handle(IPC.dashboard.show, () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  ipcMain.handle(IPC.session.start, async (_e, input?: { resumeId?: string }) => {
    // A fresh session re-arms the stealth+hideWidget posture: any prior use of
    // the Show Dashboard escape hatch should not leak into the new run.
    dashboardForcedVisible = false
    const result = await sessionManager.start(input)
    overlayWindow?.show()
    // The show listener attached in the per-window setup already reapplies
    // setContentProtection(stealthOn). No need to call applyStealth here —
    // doing so would run the bracket trick which briefly toggles affinity
    // and could flash the overlay to a screen-recorder.
    overlayWindow?.focus()
    mainWindow?.hide()
    return result
  })
  ipcMain.handle(IPC.session.stop, async () => {
    await sessionManager.stop()
    overlayWindow?.hide()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      // The show listener auto-reapplies setContentProtection. We also
      // re-evaluate skipTaskbar so the dashboard stays low-profile if the
      // user is in stealth+hideWidget mode.
      mainWindow.show()
      mainWindow.focus()
      applyDashboardVisibility()
    }
  })
  ipcMain.on(IPC.audio.chunk, (_e, channel: AudioChannel, buffer: ArrayBuffer) => {
    sessionManager.sendAudio(channel, buffer)
  })

  ipcMain.handle(
    IPC.ai.ask,
    (
      _e,
      input: {
        prompt: string
        contextSeconds?: number
        imageDataUrl?: string
        ocrText?: string
        modelOverride?: string
      }
    ) => aiAsk(input)
  )
  ipcMain.handle(IPC.ai.cancel, (_e, requestId: string) => aiCancel(requestId))
  ipcMain.handle(IPC.ai.extractQuestion, (_e, text: string) => aiExtractQuestion(text))

  ipcMain.handle(IPC.settings.get, () => getSettings())
  ipcMain.handle(IPC.settings.set, (_e, patch: Partial<AppSettings>) => {
    const next = setSettings(patch)
    // Keep the stealth/content-protection cache in sync with settings written
    // from the dashboard, otherwise the user has to toggle in the overlay too.
    if (Object.prototype.hasOwnProperty.call(patch, 'detectable')) {
      stealthOn = !next.detectable
      applyStealth()
      // Notify overlay so its UI badge flips without a polling round-trip.
      overlayWindow?.webContents.send(IPC.overlay.stealthChanged, stealthOn)
    }
    // Re-evaluate dashboard visibility whenever stealth-related settings
    // change. Covers both: detectable flipped (stealth toggled) and
    // hideWidgetWhenHidden flipped (rule itself toggled while stealth was on).
    if (
      Object.prototype.hasOwnProperty.call(patch, 'detectable') ||
      Object.prototype.hasOwnProperty.call(patch, 'hideWidgetWhenHidden')
    ) {
      applyDashboardVisibility()
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'overlayOpacity')) {
      applyOverlayOpacity()
    }
    // Broadcast the new settings to every window — the overlay holds its own
    // copy in zustand, so without this it would not pick up changes like
    // `hideWidgetWhenHidden` or `autoDetectQuestions` until app restart.
    for (const win of [mainWindow, overlayWindow]) {
      win?.webContents.send(IPC.settings.changed, next)
    }
    return next
  })

  ipcMain.handle(IPC.sessions.list, () => listSessionsFromDisk())
  ipcMain.handle(IPC.sessions.read, (_e, id: string) => readSessionFromDisk(id))
  ipcMain.handle(IPC.sessions.revealFolder, () => shell.openPath(getSessionsDir()))
  ipcMain.handle(IPC.sessions.delete, async (_e, id: string) => {
    const result = await deleteSessionFromDisk(id)
    // Best-effort cleanup of RAG embeddings for the same session.
    if (result.ok) {
      try {
        await ragDeleteSession(id)
      } catch {
        /* RAG may be unavailable — non-fatal. */
      }
    }
    return result
  })
  ipcMain.handle(IPC.sessions.revealFile, (_e, id: string) => {
    shell.showItemInFolder(getSessionMdPath(id))
  })
  ipcMain.handle(IPC.sessions.exportMarkdown, async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = {
      title: 'Export session',
      defaultPath: `${id}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await copySessionMarkdown(id, result.filePath)
    return result.filePath
  })

  ipcMain.handle(IPC.screenshot.capture, () => capturePrimaryDisplay())
  ipcMain.handle(IPC.screenshot.captureWithOcr, () => captureWithOcr())

  ipcMain.handle(IPC.documents.list, () => listReferenceDocs())
  ipcMain.handle(IPC.documents.upload, async (_e, filePaths: string[]) => {
    const added = []
    for (const p of filePaths) {
      try {
        added.push(await addReferenceDoc(p))
      } catch (err) {
        added.push({ error: (err as Error).message, path: p })
      }
    }
    return added
  })
  ipcMain.handle(IPC.documents.remove, (_e, id: string) => {
    removeReferenceDoc(id)
    return listReferenceDocs()
  })
  ipcMain.handle(IPC.documents.setActive, (_e, id: string, active: boolean) => {
    setReferenceDocActive(id, active)
    return listReferenceDocs()
  })
  ipcMain.handle(
    IPC.documents.exportSessionPdf,
    (_e, payload: SessionExportPayload) => exportSessionPdf(payload)
  )

  ipcMain.handle(IPC.rag.search, (_e, query: string, k?: number) => ragSearch(query, k ?? 6))
  ipcMain.handle(IPC.rag.deleteSession, (_e, sessionId: string) => ragDeleteSession(sessionId))
  ipcMain.handle(IPC.rag.count, () => ragCountChunks())

  ipcMain.handle(IPC.ollama.health, () => checkOllama())
  ipcMain.handle(IPC.ollama.pull, (_e, name: string) => pullModel(name))

  ipcMain.handle(IPC.personas.list, () => listPersonas())
  ipcMain.handle(IPC.personas.create, (_e, input: Omit<Persona, 'id' | 'builtin' | 'createdAt'>) =>
    createPersona(input)
  )
  ipcMain.handle(IPC.personas.update, (_e, id: string, patch: Partial<Persona>) =>
    updatePersona(id, patch)
  )
  ipcMain.handle(IPC.personas.delete, (_e, id: string) => deletePersona(id))
  ipcMain.handle(IPC.personas.importJson, (_e, json: string) => importPersonas(json))
  ipcMain.handle(IPC.personas.exportJson, (_e, ids?: string[]) => exportPersonas(ids))

  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  applyOverlayOpacity()

  for (const win of [mainWindow, overlayWindow]) {
    sessionManager.registerWindow(win)
    registerAiWindow(win)
    registerSyncWindow(win)
    registerJobsWindow(win)
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    // Setting setContentProtection BEFORE the first show on Windows is a
    // documented Electron flake — the call returns success but the HWND
    // hasn't been bound to a display affinity yet, so the protection silently
    // drops. Re-apply on every show so the very first paint already has the
    // correct affinity, and any subsequent hide→show round-trip preserves it.
    // skipTaskbar likewise needs re-applying after show() on Windows for the
    // dashboard window — the WS_EX_TOOLWINDOW style can race the HWND.
    win.on('show', () => {
      win.setContentProtection(stealthOn)
      if (win === mainWindow) applyDashboardVisibility()
    })
  }

  async function captureAndAttach(): Promise<void> {
    if (!overlayWindow) return
    // Run capture+OCR in parallel — OCR can be slow on first invocation
    // (Tesseract worker bootstrap), but the user sees the image immediately
    // because the renderer renders on the dataUrl regardless.
    const snap = await captureWithOcr().catch(() => null)
    if (!snap) return
    showOverlay()
    overlayWindow.webContents.send(IPC.overlay.snapshotAsk, snap)
  }

  // Region-cropper: open a transparent fullscreen window where the user drags
  // a rectangle, then capture only that area, OCR it, and feed the snippet
  // into the overlay's snapshot pipeline.
  let cropperWin: BrowserWindow | null = null
  function openCropper(): void {
    if (cropperWin) return
    cropperWin = createCropperWindow()
    cropperWin.once('ready-to-show', () => cropperWin?.show())
    cropperWin.on('closed', () => {
      cropperWin = null
    })
  }
  function closeCropper(): void {
    cropperWin?.close()
    cropperWin = null
  }
  async function handleCropperSubmit(rect: {
    x: number
    y: number
    w: number
    h: number
  }): Promise<void> {
    closeCropper()
    if (!overlayWindow) return
    try {
      const display = screen.getPrimaryDisplay()
      // Capture at native resolution, then crop. desktopCapturer's
      // thumbnailSize is the target raster size; we want the full-fidelity
      // image so we ask for the display's pixel size and crop in nativeImage.
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }
      })
      const primary = sources.find((s) => Number(s.display_id) === display.id) ?? sources[0]
      if (!primary || primary.thumbnail.isEmpty()) return
      const cropped = primary.thumbnail.crop({
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h
      })
      if (cropped.isEmpty()) return
      const dataUrl = cropped.toDataURL()
      const ocrText = await runOcr(dataUrl).catch(() => null)
      showOverlay()
      overlayWindow.webContents.send(IPC.overlay.snapshotAsk, { dataUrl, ocrText })
    } catch (err) {
      console.error('[cropper] submit failed', err)
    }
  }

  let chatWin: BrowserWindow | null = null
  function openChat(): void {
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.focus()
      return
    }
    chatWin = createChatWindow()
    chatWin.once('ready-to-show', () => chatWin?.show())
    chatWin.on('closed', () => {
      chatWin = null
    })
    registerAiWindow(chatWin)
    registerJobsWindow(chatWin)
  }

  ipcMain.handle(IPC.cropper.open, () => openCropper())
  ipcMain.handle(IPC.cropper.cancel, () => closeCropper())
  ipcMain.handle(
    IPC.cropper.submit,
    (_e, rect: { x: number; y: number; w: number; h: number }) => handleCropperSubmit(rect)
  )

  registerShortcuts({
    onToggleOverlay: () => {
      if (!overlayWindow) return
      if (overlayWindow.isVisible()) overlayWindow.hide()
      else showOverlay()
    },
    onAskAi: () => {
      showOverlay()
      overlayWindow?.webContents.send(IPC.overlay.focusAsk)
    },
    onAnswerLast: () => {
      showOverlay()
      overlayWindow?.webContents.send(IPC.overlay.answerLast)
    },
    onHideShow: () => {
      if (!overlayWindow) return
      if (overlayWindow.isVisible()) overlayWindow.hide()
      else showOverlay()
    },
    onScreenshot: () => {
      void captureAndAttach()
    },
    onCropper: () => openCropper(),
    onChat: () => openChat(),
    onShowDashboard: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      // Force the dashboard back into the foreground even if stealth+hideWidget
      // dropped it from Alt+Tab/taskbar — that combination used to be a one-way
      // trip that required relaunching the app. We override the low-profile
      // posture for this window until the next session boundary, so the user
      // can actually interact with the dashboard they just summoned.
      dashboardForcedVisible = true
      mainWindow.setSkipTaskbar(false)
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      overlayWindow = createOverlayWindow()
    }
  })
})

app.on('will-quit', () => {
  unregisterShortcuts()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
