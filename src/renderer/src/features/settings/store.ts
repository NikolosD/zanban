import { create } from 'zustand'
import type { AppSettings } from '@shared/types'

interface SettingsState {
  settings: AppSettings | null
  load(): Promise<void>
  refresh(): Promise<void>
  apply(next: AppSettings): void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  async load() {
    const settings = await window.zanban.settings.get()
    set({ settings })
  },
  async refresh() {
    const settings = await window.zanban.settings.get()
    set({ settings })
  },
  apply(next) {
    set({ settings: next })
  }
}))

/**
 * Subscribe a window to live settings broadcasts from main. Returns an
 * unsubscribe — call from a top-level mount effect of the window's app shell.
 */
export function wireSettingsIpc(): () => void {
  return window.zanban.settings.onChanged((next) => {
    useSettingsStore.getState().apply(next)
  })
}
