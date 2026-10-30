import type { AppSettings } from '@shared/types'

export type HotkeyKey = keyof AppSettings['hotkeys']

const LABELS: Record<HotkeyKey, string> = {
  toggleSession: 'Start / stop session',
  toggleOverlay: 'Toggle overlay',
  askAi: 'Focus ask',
  answerLast: 'Answer last',
  hideShow: 'Toggle stealth',
  screenshot: 'Snap full screen → Ask',
  screenshotAnswer: 'Snap full screen → Answer',
  cropper: 'Drag region → OCR Ask',
  chat: 'Open chat window',
  showDashboard: 'Force-show dashboard',
  scrollAnswerUp: 'Scroll answer up',
  scrollAnswerDown: 'Scroll answer down',
  expandCode: 'Expand / collapse code'
}

const HINTS: Record<HotkeyKey, string> = {
  toggleSession: 'Start recording a session, or stop the one in progress.',
  toggleOverlay: 'Show or hide the floating assistant.',
  askAi: 'Focus the Ask input from anywhere.',
  answerLast: 'Answer the last detected question with one keypress.',
  hideShow: 'Toggle stealth — hides from screen-share.',
  screenshot: 'Capture full screen, OCR it, attach to next Ask.',
  screenshotAnswer: 'Capture full screen and answer it instantly — no manual Ask.',
  cropper: 'Drag a region, OCR only that area, attach to next Ask.',
  chat: 'Open the standalone chat window (no transcript context).',
  showDashboard:
    'Brings back the dashboard window when stealth + hide-widget mode would otherwise leave it unreachable.',
  scrollAnswerUp: 'Scroll the overlay answer up a page without leaving your editor.',
  scrollAnswerDown: 'Scroll the overlay answer down a page without leaving your editor.',
  expandCode: 'Grow the code block in view to the full screen height, or return to the answer.'
}

export function hotkeyLabel(k: string): string {
  return LABELS[k as HotkeyKey] ?? k
}

export function hotkeyHint(k: string): string {
  return HINTS[k as HotkeyKey] ?? ''
}

const COMPACT_TOKENS: Record<string, string> = {
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Win: '⊞',
  Tab: '⇥',
  Space: '␣',
  Esc: '⎋'
}

/** Key words to single glyphs ("Ctrl", "Shift" → "⌃", "⇧") so a chord fits a chip. */
export function compactHotkeyTokens(tokens: string[]): string[] {
  return tokens.map((t) => COMPACT_TOKENS[t] ?? t)
}
