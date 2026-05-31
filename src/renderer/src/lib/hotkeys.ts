import type { AppSettings } from '@shared/types'

export type HotkeyKey = keyof AppSettings['hotkeys']

const LABELS: Record<HotkeyKey, string> = {
  toggleOverlay: 'Toggle overlay',
  askAi: 'Focus ask',
  answerLast: 'Answer last',
  hideShow: 'Toggle stealth',
  screenshot: 'Snap full screen → Ask',
  screenshotAnswer: 'Snap full screen → Answer',
  cropper: 'Drag region → OCR Ask',
  chat: 'Open chat window',
  showDashboard: 'Force-show dashboard'
}

const HINTS: Record<HotkeyKey, string> = {
  toggleOverlay: 'Show or hide the floating assistant.',
  askAi: 'Focus the Ask input from anywhere.',
  answerLast: 'Answer the last detected question with one keypress.',
  hideShow: 'Toggle stealth — hides from screen-share.',
  screenshot: 'Capture full screen, OCR it, attach to next Ask.',
  screenshotAnswer: 'Capture full screen and answer it instantly — no manual Ask.',
  cropper: 'Drag a region, OCR only that area, attach to next Ask.',
  chat: 'Open the standalone chat window (no transcript context).',
  showDashboard:
    'Brings back the dashboard window when stealth + hide-widget mode would otherwise leave it unreachable.'
}

export function hotkeyLabel(k: string): string {
  return LABELS[k as HotkeyKey] ?? k
}

export function hotkeyHint(k: string): string {
  return HINTS[k as HotkeyKey] ?? ''
}
