import { DEFAULT_SETTINGS, type AppSettings } from './types.js'

/** Settings fields encrypted at rest and never sent to a renderer in clear. */
export const SECRET_SETTING_KEYS = [
  'googleServiceAccountJson',
  'vercelApiKey',
  'deepgramApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'googleAiApiKey',
  'groqApiKey',
  'elevenlabsApiKey',
  'tavilyApiKey'
] as const satisfies ReadonlyArray<keyof AppSettings>

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number]

/**
 * Renderers see a stored secret only as this prefix plus (for token-shaped
 * values) its last four characters — enough to show "configured · ••••1234",
 * useless as a credential. Main drops the marker when a patch echoes it back.
 */
export const REDACTED_SECRET_PREFIX = 'zanban-redacted:'

const TOKEN_TAIL = /^[\w-]{4}$/
// A tail of a short value would give most of it away.
const MIN_LENGTH_FOR_TAIL = 12

export function redactSecret(value: string | null): string | null {
  if (!value) return null
  const tail = value.slice(-4)
  const shown = value.length >= MIN_LENGTH_FOR_TAIL && TOKEN_TAIL.test(tail) ? tail : ''
  return REDACTED_SECRET_PREFIX + shown
}

export function isRedactedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(REDACTED_SECRET_PREFIX)
}

/** "••••1234", or just "••••" when the marker carries no tail. */
export function redactedSecretMask(marker: string): string {
  return `••••${marker.slice(REDACTED_SECRET_PREFIX.length)}`
}

/** What a renderer may hold: the known settings fields, secrets redacted. */
export function redactSettings(settings: AppSettings): AppSettings {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    out[key] = settings[key]
  }
  for (const key of SECRET_SETTING_KEYS) out[key] = redactSecret(settings[key])
  return out as unknown as AppSettings
}

export function isValidOllamaHost(value: string): boolean {
  if (value.trim() === '') return true
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
