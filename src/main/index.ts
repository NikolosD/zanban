import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  crashReporter,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell
} from 'electron'
import { getAppIcon } from './appIcon.js'
import { createMainWindow } from './windows/mainWindow.js'
import { createOverlayWindow } from './windows/overlayWindow.js'
import { IPC } from '../shared/ipc-channels.js'
import { sessionManager } from './transcription/sessionManager.js'
import { registerAiWindow } from './ai/aiGatewayClient.js'
import { getSettings, setSettings } from './settings.js'
import type { AppSettings, AudioChannel } from '../shared/types.js'
import { registerSyncWindow, awaitSessionFinalized } from './sync/sessionSync.js'
import { captureInstant, getActiveDisplay } from './screenshot/index.js'
import { cssRectToCroppedPx } from './screenshot/cropGeometry.js'
import { runOcr, terminateOcrWorker } from './screenshot/ocrPipeline.js'
import type { ScreenSnapshotOcr } from '../shared/types.js'
import { createCropperWindow } from './windows/cropperWindow.js'
import { createChatWindow } from './windows/chatWindow.js'
import { initAutoUpdate } from './updater/autoUpdate.js'
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js'
import { registerJobsWindow, trackJob } from './services/jobsManager.js'
import { installLogger } from './services/logger.js'
import { registerAiHandlers } from './ipc/ai.js'
import { registerAppHandlers } from './ipc/app.js'
import { registerDocumentsHandlers } from './ipc/documents.js'
import { registerOllamaHandlers } from './ipc/ollama.js'
import { registerProvidersHandlers } from './ipc/providers.js'
import { registerPersonasHandlers } from './ipc/personas.js'
import { registerRagHandlers } from './ipc/rag.js'
import { registerScreenshotHandlers } from './ipc/screenshot.js'
import { registerSessionsHandlers } from './ipc/sessions.js'
import { registerRecapHandlers, getRecapService } from './ipc/recap.js'
import { createAutoTrigger } from './services/recap/recapAutoTrigger.js'

installLogger()

// Local-only crash dumps. submitURL is required by Electron's API but with
// uploadToServer: false nothing is ever sent — dumps live in
// `app.getPath('crashDumps')` so the user can attach them to a bug report
// manually. Must be called before any window opens to capture renderer
// crashes too.
crashReporter.start({
  productName: 'Zanban',
  submitURL: '',
  uploadToServer: false,
  ignoreSystemCrashHandler: false
})

// Display name used by app menus, the macOS About panel, and any code that
// reads `app.getName()`. Without this the dev build shows "Electron" in
// places electron-builder's productName doesn't reach.
app.setName('Zanban')

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

  // About-panel content (macOS shows it via the app menu; Linux ditto via
  // GTK). Windows uses electron-builder's installer metadata instead.
  app.setAboutPanelOptions({
    applicationName: 'Zanban',
    applicationVersion: app.getVersion(),
    copyright: 'MIT licensed · github.com/NikolosD/zanban',
    iconPath: undefined
  })

  // Replace the default menu (Edit/View/Help boilerplate) with a minimal
  // app menu on macOS — required there for Cmd+Q/H to work — and drop the
  // menu bar entirely on Windows/Linux where it would only add noise.
  installAppMenu()

  // Override the dev-mode dock icon on macOS so Cmd+Tab and the dock show
  // our brand instead of the generic Electron mark. In packaged builds the
  // bundle's Info.plist already wins; this is a no-op there but harmless.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(getAppIcon())
  }

  // App-switcher posture: macOS hides the dock icon (also drops Cmd+Tab);
  // Windows/Linux toggle setSkipTaskbar on every BrowserWindow we make.
  // Has to run before any window is created on macOS — calling dock.hide()
  // after the dock has been shown is a no-op until next launch.
  applyAppSwitcherVisibility()

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

  registerAppHandlers()
  registerAiHandlers()
  registerScreenshotHandlers()
  registerDocumentsHandlers()
  registerRagHandlers()
  registerOllamaHandlers()
  registerProvidersHandlers()
  registerPersonasHandlers()
  registerSessionsHandlers()
  registerRecapHandlers()

  // Auto-generate recap when the user stops a session (opt-in via settings).
  // Uses the sessionManager end-listener so all stop paths (IPC, hotkey, etc.)
  // are covered. Best-effort — errors are swallowed inside the trigger.
  const autoTrigger = createAutoTrigger({
    getSettings,
    generate: (id) => getRecapService().generate(id, {}),
    trackJob,
    awaitFinalized: awaitSessionFinalized,
    getExisting: (id) => getRecapService().get(id)
  })
  sessionManager.onSessionEnd((sessionId) => {
    void autoTrigger.onSessionStopped(sessionId)
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
  //
  // The cross-platform `hideFromAppSwitcher` flag also forces low-profile —
  // it's a stronger "I don't want the app to show up anywhere" toggle and
  // should override `dashboardForcedVisible` only on Windows (macOS handles
  // its own app-switcher posture via `app.dock.hide()`).
  function applyDashboardVisibility(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const settings = getSettings()
    const lowProfile =
      settings.hideFromAppSwitcher ||
      (stealthOn && settings.hideWidgetWhenHidden && !dashboardForcedVisible)
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

  // Cross-platform "hide me from the OS app-switcher". On macOS this is the
  // dock; on Windows/Linux it's the taskbar/Alt+Tab. Called once on launch
  // and again whenever the user toggles the setting.
  //
  // macOS dock.hide() must be called before any window paints — calling it
  // after the dock has surfaced is a no-op until next launch (we surface a
  // restart hint in the UI to match). Windows updates apply immediately.
  function applyAppSwitcherVisibility(): void {
    const hide = getSettings().hideFromAppSwitcher
    if (process.platform === 'darwin') {
      if (hide) app.dock?.hide()
      else app.dock?.show()
    }
    // Dashboard taskbar posture lives in applyDashboardVisibility — keep
    // the two in lockstep when this flag changes.
    applyDashboardVisibility()
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
  // Renderer measures the visible glass panel and asks us to resize the
  // window to match. We clamp to the current display's work area so a long
  // streamed answer never drives the window off-screen — anything beyond the
  // cap falls back to the inner pane scrolling.
  ipcMain.handle(IPC.overlay.setContentHeight, (_e, requested: number) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const bounds = overlayWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workH = display.workArea.height
    const margin = 24
    const min = 120
    const max = Math.max(min, workH - bounds.y - margin)
    const next = Math.max(min, Math.min(max, Math.ceil(requested)))
    const [curW = 0, curH = 0] = overlayWindow.getContentSize()
    if (Math.abs(curH - next) < 2) return
    overlayWindow.setContentSize(curW, next, false)
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
    if (Object.prototype.hasOwnProperty.call(patch, 'hideFromAppSwitcher')) {
      applyAppSwitcherVisibility()
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'overlayOpacity')) {
      applyOverlayOpacity()
    }
    // Broadcast the new settings to every window — the overlay holds its own
    // copy in zustand, so without this it would not pick up changes like
    // `hideWidgetWhenHidden` until app restart.
    for (const win of [mainWindow, overlayWindow]) {
      win?.webContents.send(IPC.settings.changed, next)
    }
    return next
  })

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
    // Instant image, background OCR (F1): the snapshot comes back at once with
    // ocrText: null so the overlay paints the image immediately. The OCR text
    // arrives a beat later on the `screenshot.ocr` channel keyed by snapshotId,
    // and the overlay folds it into the in-flight snapshot.
    const snap = await captureInstant((snapshotId, ocrText) => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        const payload: ScreenSnapshotOcr = { snapshotId, ocrText }
        overlayWindow.webContents.send(IPC.screenshot.ocr, payload)
      }
    }).catch(() => null)
    if (!snap) return
    showOverlay()
    overlayWindow.webContents.send(IPC.overlay.snapshotAsk, snap)
  }

  // Region-cropper: open a transparent fullscreen window where the user drags
  // a rectangle, then capture only that area, OCR it, and feed the snippet
  // into the overlay's snapshot pipeline.
  let cropperWin: BrowserWindow | null = null
  // The display the cropper was opened on. Pinned at open time so the drag
  // surface, the captured background image, and the crop coordinates all refer
  // to the SAME display — even if the cursor drifts to another monitor mid-drag
  // (which would otherwise make a fresh getActiveDisplay() at submit diverge
  // from the window the user actually dragged on).
  let cropperDisplay: Electron.Display | null = null
  function openCropper(): void {
    if (cropperWin) return
    // F2: open on the display under the cursor, not the hardcoded primary.
    cropperDisplay = getActiveDisplay()
    cropperWin = createCropperWindow(cropperDisplay)
    cropperWin.once('ready-to-show', () => cropperWin?.show())
    // F4: Alt-Tab / clicking away used to leave the dimming overlay stuck on
    // screen. Treat losing focus as a cancel so the overlay never lingers.
    cropperWin.on('blur', () => closeCropper())
    cropperWin.on('closed', () => {
      cropperWin = null
    })
  }
  function closeCropper(): void {
    if (!cropperWin) return
    const win = cropperWin
    cropperWin = null
    if (!win.isDestroyed()) win.close()
  }
  async function handleCropperSubmit(rect: {
    x: number
    y: number
    w: number
    h: number
    dpr: number
  }): Promise<void> {
    // Resolve the cropper's display BEFORE closeCropper() clears the pin.
    // Fall back to the active display if it's somehow unset (defensive).
    const display = cropperDisplay ?? getActiveDisplay()
    cropperDisplay = null
    closeCropper()
    if (!overlayWindow) return
    try {
      // Capture at native resolution, then crop. desktopCapturer's
      // thumbnailSize is the target raster size; we want the full-fidelity
      // image so we ask for the display's pixel size and crop in nativeImage.
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor)
        }
      })
      const match = sources.find((s) => Number(s.display_id) === display.id) ?? sources[0]
      if (!match || match.thumbnail.isEmpty()) return
      const { width: srcW, height: srcH } = match.thumbnail.getSize()
      // F3: the renderer reported CSS px tagged with its devicePixelRatio; the
      // source is rastered at the display's scaleFactor. Reconcile + clamp to
      // the source bounds in MAIN before cropping, so edge selections can't
      // throw or yield a garbled crop. Pure math lives in cropGeometry.
      const cropRect = cssRectToCroppedPx(rect, display.scaleFactor, srcW, srcH)
      if (!cropRect) return
      const cropped = match.thumbnail.crop(cropRect)
      if (cropped.isEmpty()) return
      const dataUrl = cropped.toDataURL()
      const snapshotId = randomUUID()
      // Instant image, background OCR (F1) — same contract as captureAndAttach.
      showOverlay()
      overlayWindow.webContents.send(IPC.overlay.snapshotAsk, {
        snapshotId,
        dataUrl,
        ocrText: null
      })
      void runOcr(dataUrl)
        .then((ocrText) => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            const payload: ScreenSnapshotOcr = { snapshotId, ocrText }
            overlayWindow.webContents.send(IPC.screenshot.ocr, payload)
          }
        })
        .catch(() => {})
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
    (_e, rect: { x: number; y: number; w: number; h: number; dpr: number }) =>
      handleCropperSubmit(rect)
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

/**
 * On macOS Cocoa requires an app menu — the OS menu bar is rendered from
 * it, and Cmd+Q / Cmd+H / About wire up via the standard roles. Build the
 * smallest such menu so the app looks native instead of inheriting
 * Electron's default Edit/View/Help boilerplate.
 *
 * On Windows/Linux there's no required menu; clear it so no menu bar
 * appears at all. Per-window `autoHideMenuBar: true` already hides it
 * visually, but `Menu.setApplicationMenu(null)` makes it impossible to
 * surface via Alt.
 */
function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Zanban',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('will-quit', () => {
  unregisterShortcuts()
  // F4: tear down the singleton Tesseract worker (WASM/process) so it doesn't
  // leak on exit. Best-effort — terminateOcrWorker swallows its own errors.
  void terminateOcrWorker()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
