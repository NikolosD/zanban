interface PaintingWindow {
  once(event: 'ready-to-show', listener: () => void): unknown
}

// Long enough for the shown window to present its first frame.
const SETTLE_MS = 250
const FALLBACK_MS = 5000

/**
 * Runs `task` once, shortly after `win` has painted its first frame, so work the
 * first frame doesn't need stays off the launch path. A window that never paints
 * still gets the task after a fallback delay.
 */
export function runAfterFirstPaint(win: PaintingWindow, task: () => void): void {
  let ran = false
  const run = (): void => {
    if (ran) return
    ran = true
    task()
  }
  win.once('ready-to-show', () => setTimeout(run, SETTLE_MS))
  setTimeout(run, FALLBACK_MS)
}
