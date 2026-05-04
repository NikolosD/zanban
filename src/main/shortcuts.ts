import { globalShortcut } from 'electron'
import { getSettings } from './settings.js'

export interface ShortcutHandlers {
  onToggleOverlay(): void
  onAskAi(): void
  onAnswerLast(): void
  onHideShow(): void
  onScreenshot(): void
  onCropper(): void
  onChat(): void
  onShowDashboard(): void
}

let registered: string[] = []

export function registerShortcuts(handlers: ShortcutHandlers): void {
  unregisterShortcuts()
  const { hotkeys } = getSettings()
  const tries: Array<[string | undefined, () => void]> = [
    [hotkeys.toggleOverlay, handlers.onToggleOverlay],
    [hotkeys.askAi, handlers.onAskAi],
    [hotkeys.answerLast, handlers.onAnswerLast],
    [hotkeys.hideShow, handlers.onHideShow],
    [hotkeys.screenshot, handlers.onScreenshot],
    [hotkeys.cropper, handlers.onCropper],
    [hotkeys.chat, handlers.onChat],
    [hotkeys.showDashboard, handlers.onShowDashboard]
  ]
  for (const [accelerator, fn] of tries) {
    if (!accelerator) continue
    try {
      const ok = globalShortcut.register(accelerator, fn)
      if (ok) registered.push(accelerator)
    } catch {
      /* ignore conflicts */
    }
  }
}

export function unregisterShortcuts(): void {
  for (const a of registered) globalShortcut.unregister(a)
  registered = []
}
