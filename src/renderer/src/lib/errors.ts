const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*': /
const ERROR_PREFIX = /^Error: /

/** User-facing text for a caught error, minus Electron's IPC wrapper prefix. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(REMOTE_METHOD_PREFIX, '').replace(ERROR_PREFIX, '')
}

/** Main's credential guards ("… key not set. Open Settings.") all point the user at Settings. */
export function pointsToSettings(message: string): boolean {
  return /\bnot (set|configured)\b|\bopen settings\b/i.test(message)
}
