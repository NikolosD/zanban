import { globalShortcut } from 'electron'
import { getSettings } from './settings.js'

export interface ShortcutHandlers {
  onToggleOverlay(): void
  onAskAi(): void
  onAnswerLast(): void
  onHideShow(): void
  onScreenshot(): void
  onScreenshotAnswer(): void
  onCropper(): void
  onChat(): void
  onShowDashboard(): void
}

/** Hotkey ids that failed to register, keyed by the accelerator that clashed. */
export interface ShortcutRegistration {
  /** Accelerators that could not be registered (taken by another app, invalid). */
  failed: Array<{ action: keyof AppHotkeys; accelerator: string }>
}

type AppHotkeys = ReturnType<typeof getSettings>['hotkeys']

let registered: string[] = []
// Cached so `reRegisterShortcuts()` can re-run after a rebind without the
// caller having to thread the handler closures through settings.set.
let lastHandlers: ShortcutHandlers | null = null

export function registerShortcuts(handlers: ShortcutHandlers): ShortcutRegistration {
  lastHandlers = handlers
  unregisterShortcuts()
  const { hotkeys } = getSettings()
  const tries: Array<[keyof AppHotkeys, string | undefined, () => void]> = [
    ['toggleOverlay', hotkeys.toggleOverlay, handlers.onToggleOverlay],
    ['askAi', hotkeys.askAi, handlers.onAskAi],
    ['answerLast', hotkeys.answerLast, handlers.onAnswerLast],
    ['hideShow', hotkeys.hideShow, handlers.onHideShow],
    ['screenshot', hotkeys.screenshot, handlers.onScreenshot],
    ['screenshotAnswer', hotkeys.screenshotAnswer, handlers.onScreenshotAnswer],
    ['cropper', hotkeys.cropper, handlers.onCropper],
    ['chat', hotkeys.chat, handlers.onChat],
    ['showDashboard', hotkeys.showDashboard, handlers.onShowDashboard]
  ]
  const failed: ShortcutRegistration['failed'] = []
  for (const [action, accelerator, fn] of tries) {
    if (!accelerator) continue
    try {
      const ok = globalShortcut.register(accelerator, fn)
      if (ok) registered.push(accelerator)
      else failed.push({ action, accelerator })
    } catch {
      // register() throws on a malformed accelerator (vs. returning false for
      // an OS-level conflict) — treat both as a registration failure.
      failed.push({ action, accelerator })
    }
  }
  return { failed }
}

/**
 * Re-register all global shortcuts from the current settings. Called after a
 * rebind so the new accelerators take effect without an app restart. No-op
 * (returns no failures) if shortcuts were never registered yet.
 */
export function reRegisterShortcuts(): ShortcutRegistration {
  if (!lastHandlers) return { failed: [] }
  return registerShortcuts(lastHandlers)
}

export function unregisterShortcuts(): void {
  for (const a of registered) globalShortcut.unregister(a)
  registered = []
}
