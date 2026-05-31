import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import { getAppIcon } from './appIcon.js'
import { translate as t } from './i18n.js'
import { sessionManager } from './transcription/sessionManager.js'

/**
 * Actions the tray menu drives. These are the SAME closures index.ts already
 * wires for hotkeys / IPC handlers — the tray reuses them rather than
 * duplicating window logic.
 */
export interface TrayActions {
  startSession(): void
  stopSession(): void
  showOverlay(): void
  showDashboard(): void
  openSettings(): void
  askAi(): void
  toggleStealth(): void
  getStealth(): boolean
  quit(): void
}

let tray: Tray | null = null
let currentActions: TrayActions | null = null

/**
 * Build the tray icon at the size the platform's status area expects. On
 * Windows/Linux a 16px image reads crisply; macOS wants a ~16–18px template
 * image (monochrome). We resize the bundled app PNG; if it fails to load we
 * fall back to an empty image so the tray still appears.
 */
function trayIconImage(): NativeImage {
  const base = getAppIcon()
  if (base.isEmpty()) return nativeImage.createEmpty()
  return base.resize({ width: 16, height: 16 })
}

/**
 * Create the system tray. Combined with stealth + hideWidget + hideFromApp-
 * Switcher, the dashboard can vanish from the taskbar/Alt+Tab — the tray is
 * the reliable way back in. Reflects recording state in tooltip + the
 * Start/Stop label, and rebuilds the menu whenever session state changes.
 */
export function createTray(actions: TrayActions): Tray {
  currentActions = actions
  if (tray && !tray.isDestroyed()) {
    rebuildTray()
    return tray
  }

  tray = new Tray(trayIconImage())
  // Single click / double click surfaces the dashboard — the most common
  // "bring the app back" intent. Left-click only fires on Windows; macOS/Linux
  // open the context menu, which already has Show dashboard.
  tray.on('click', () => actions.showDashboard())
  tray.on('double-click', () => actions.showDashboard())

  rebuildTray()

  // Keep the menu label + tooltip in sync with the live session state so the
  // user always sees the right "Start/Stop session" verb and recording hint.
  sessionManager.onState(() => rebuildTray())
  return tray
}

/**
 * Rebuild the context menu + tooltip from current session/stealth state.
 * Cheap enough to call on every state transition.
 */
export function rebuildTray(): void {
  if (!tray || tray.isDestroyed() || !currentActions) return
  const actions = currentActions
  const recording = sessionManager.getState().kind === 'running'
  const stealthOn = actions.getStealth()

  tray.setToolTip(recording ? t('tray.tooltip_recording') : t('tray.tooltip_idle'))

  const menu = Menu.buildFromTemplate([
    {
      label: recording ? t('tray.stop_session') : t('tray.start_session'),
      click: () => (recording ? actions.stopSession() : actions.startSession())
    },
    { type: 'separator' },
    { label: t('tray.show_overlay'), click: () => actions.showOverlay() },
    { label: t('tray.show_dashboard'), click: () => actions.showDashboard() },
    { label: t('tray.ask_ai'), click: () => actions.askAi() },
    { type: 'separator' },
    {
      // Checkbox reflects whether stealth is currently engaged; the label
      // states the resulting posture so the user knows what they're toggling.
      label: stealthOn ? t('tray.stealth_on') : t('tray.stealth_off'),
      type: 'checkbox',
      checked: stealthOn,
      click: () => {
        actions.toggleStealth()
        rebuildTray()
      }
    },
    { type: 'separator' },
    { label: t('tray.settings'), click: () => actions.openSettings() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => actions.quit() }
  ])
  tray.setContextMenu(menu)
}

/** Tear down the tray on app quit. Safe to call when no tray exists. */
export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
  currentActions = null
}
