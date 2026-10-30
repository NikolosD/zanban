import { globalShortcut } from 'electron'
import { alternativeAccelerators } from './hotkeyAlternatives.js'
import { getSettings } from './settings.js'

export interface ShortcutHandlers {
  onToggleSession(): void
  onToggleOverlay(): void
  onAskAi(): void
  onAnswerLast(): void
  onHideShow(): void
  onScreenshot(): void
  onScreenshotAnswer(): void
  onCropper(): void
  onChat(): void
  onShowDashboard(): void
  onScrollAnswerUp(): void
  onScrollAnswerDown(): void
  onExpandCode(): void
}

/** Hotkey ids that failed to register, keyed by the accelerator that clashed. */
export interface ShortcutRegistration {
  /** Accelerators that could not be registered (taken by another app, invalid). */
  failed: Array<{ action: keyof AppHotkeys; accelerator: string }>
}

export interface PickFreeResult {
  /** Actions moved to an accelerator that registered. */
  assigned: ShortcutRegistration['failed']
  /** Actions no alternative could be found for, with the accelerator they still have. */
  unresolved: ShortcutRegistration['failed']
}

type AppHotkeys = ReturnType<typeof getSettings>['hotkeys']

let registered: string[] = []
let conflicts: ShortcutRegistration['failed'] = []
// Cached so `reRegisterShortcuts()` can re-run after a rebind without the
// caller having to thread the handler closures through settings.set.
let lastHandlers: ShortcutHandlers | null = null

function actionHandlers(handlers: ShortcutHandlers): Record<keyof AppHotkeys, () => void> {
  return {
    toggleSession: handlers.onToggleSession,
    toggleOverlay: handlers.onToggleOverlay,
    askAi: handlers.onAskAi,
    answerLast: handlers.onAnswerLast,
    hideShow: handlers.onHideShow,
    screenshot: handlers.onScreenshot,
    screenshotAnswer: handlers.onScreenshotAnswer,
    cropper: handlers.onCropper,
    chat: handlers.onChat,
    showDashboard: handlers.onShowDashboard,
    scrollAnswerUp: handlers.onScrollAnswerUp,
    scrollAnswerDown: handlers.onScrollAnswerDown,
    expandCode: handlers.onExpandCode
  }
}

export function registerShortcuts(handlers: ShortcutHandlers): ShortcutRegistration {
  lastHandlers = handlers
  unregisterShortcuts()
  const { hotkeys } = getSettings()
  const byAction = actionHandlers(handlers)
  const failed: ShortcutRegistration['failed'] = []
  for (const action of Object.keys(byAction) as Array<keyof AppHotkeys>) {
    const accelerator = hotkeys[action]
    if (!accelerator) continue
    try {
      const ok = globalShortcut.register(accelerator, byAction[action])
      if (ok) registered.push(accelerator)
      else failed.push({ action, accelerator })
    } catch {
      // register() throws on a malformed accelerator (vs. returning false for
      // an OS-level conflict) — treat both as a registration failure.
      failed.push({ action, accelerator })
    }
  }
  conflicts = failed
  return { failed }
}

/** Hotkeys that failed in the latest registration, for a window that loads after it. */
export function shortcutConflicts(): ShortcutRegistration['failed'] {
  return conflicts
}

// register() refuses a chord this app already owns, in any spelling, which is
// what keeps the unregister below from dropping one of its live hotkeys.
function registersFree(accelerator: string, fn: () => void): boolean {
  try {
    if (!globalShortcut.register(accelerator, fn)) return false
    globalShortcut.unregister(accelerator)
    return true
  } catch {
    return false
  }
}

/**
 * Finds a free alternative for every hotkey that failed to register and hands
 * the complete new map to `persist`. Candidates are only probed here — the
 * settings write re-registers everything, so nothing is left bound twice.
 */
export function pickFreeShortcuts(persist: (hotkeys: AppHotkeys) => void): PickFreeResult {
  if (!lastHandlers || conflicts.length === 0) return { assigned: [], unresolved: [] }
  const byAction = actionHandlers(lastHandlers)
  const next = { ...getSettings().hotkeys }
  const taken = new Set(Object.values(next))
  const assigned: PickFreeResult['assigned'] = []
  const unresolved: PickFreeResult['unresolved'] = []
  for (const { action, accelerator } of conflicts) {
    const free = alternativeAccelerators(taken).find((candidate) =>
      registersFree(candidate, byAction[action])
    )
    if (free) {
      next[action] = free
      taken.add(free)
      assigned.push({ action, accelerator: free })
    } else {
      unresolved.push({ action, accelerator })
    }
  }
  if (assigned.length > 0) persist(next)
  return { assigned, unresolved }
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
