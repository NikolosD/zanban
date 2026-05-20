import Store from 'electron-store'
import { safeStorage } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types.js'

type EncryptedKeys =
  | 'googleServiceAccountJson'
  | 'vercelApiKey'
  | 'deepgramApiKey'
  | 'anthropicApiKey'
  | 'openaiApiKey'
  | 'googleAiApiKey'
  | 'groqApiKey'
  | 'elevenlabsApiKey'
  | 'tavilyApiKey'

const ENCRYPTED_KEYS: EncryptedKeys[] = [
  'googleServiceAccountJson',
  'vercelApiKey',
  'deepgramApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'googleAiApiKey',
  'groqApiKey',
  'elevenlabsApiKey',
  'tavilyApiKey'
]

type PersistedSettings = Omit<AppSettings, EncryptedKeys> & {
  [K in EncryptedKeys as `${K}Enc`]?: string | null
}

const store = new Store<PersistedSettings>({
  name: 'settings',
  defaults: stripKeys(DEFAULT_SETTINGS)
})

function stripKeys(s: AppSettings): PersistedSettings {
  const out = { ...s } as Record<string, unknown>
  for (const k of ENCRYPTED_KEYS) delete out[k]
  return out as PersistedSettings
}

/**
 * Settings used to store `aiModels` as a flat `{ fast, filter, summary, vision }`
 * — implicitly the Vercel Gateway slot. After the per-provider rewrite, the
 * shape became `Partial<Record<llmProvider, AiModelSettings>>`. Old stores get
 * folded into the `vercel-gateway` bucket so users don't lose their overrides.
 */
function migrateAiModels(raw: unknown): AppSettings['aiModels'] {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  // Detect legacy flat shape: keys are role names, values are strings.
  const looksLegacy = ['fast', 'filter', 'summary', 'vision'].some(
    (k) => k in obj && typeof obj[k] === 'string'
  )
  if (looksLegacy) {
    return {
      'vercel-gateway': {
        fast: String(obj.fast ?? ''),
        filter: String(obj.filter ?? ''),
        summary: String(obj.summary ?? ''),
        vision: String(obj.vision ?? '')
      }
    }
  }
  return obj as AppSettings['aiModels']
}

function encrypt(value: string | null | undefined): string | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(enc: string | null | undefined): string | null {
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function getSettings(): AppSettings {
  const raw = store.store as PersistedSettings & Record<string, unknown>
  // Migrate the old macOS-only `hideDockMacOS` flag into the cross-platform
  // `hideFromAppSwitcher`. Old installs that toggled the dock-hide should
  // keep that behaviour after upgrade without re-toggling.
  const legacyHideDock = raw['hideDockMacOS']
  const hideFromAppSwitcher =
    typeof raw.hideFromAppSwitcher === 'boolean'
      ? raw.hideFromAppSwitcher
      : typeof legacyHideDock === 'boolean'
        ? legacyHideDock
        : DEFAULT_SETTINGS.hideFromAppSwitcher
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    hideFromAppSwitcher,
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(raw.hotkeys ?? {}) },
    audio: { ...DEFAULT_SETTINGS.audio, ...(raw.audio ?? {}) },
    recap: { ...DEFAULT_SETTINGS.recap, ...(raw.recap ?? {}) },
    aiModels: migrateAiModels(raw.aiModels),
    googleProjectId: raw.googleProjectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? null,
    // Encrypted keys are restored individually so we can each pull a separate
    // env-var fallback (useful in dev / CI where secrets come from .env).
    googleServiceAccountJson:
      decrypt(raw.googleServiceAccountJsonEnc) ??
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
      null,
    deepgramApiKey: decrypt(raw.deepgramApiKeyEnc) ?? process.env.DEEPGRAM_API_KEY ?? null,
    vercelApiKey: decrypt(raw.vercelApiKeyEnc) ?? process.env.AI_GATEWAY_API_KEY ?? null,
    anthropicApiKey: decrypt(raw.anthropicApiKeyEnc) ?? process.env.ANTHROPIC_API_KEY ?? null,
    openaiApiKey: decrypt(raw.openaiApiKeyEnc) ?? process.env.OPENAI_API_KEY ?? null,
    googleAiApiKey: decrypt(raw.googleAiApiKeyEnc) ?? process.env.GOOGLE_AI_API_KEY ?? null,
    groqApiKey: decrypt(raw.groqApiKeyEnc) ?? process.env.GROQ_API_KEY ?? null,
    elevenlabsApiKey: decrypt(raw.elevenlabsApiKeyEnc) ?? process.env.ELEVENLABS_API_KEY ?? null,
    tavilyApiKey: decrypt(raw.tavilyApiKeyEnc) ?? process.env.TAVILY_API_KEY ?? null
  }
  return merged
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...getSettings(), ...patch }
  const next: Partial<PersistedSettings> = stripKeys(merged)
  for (const k of ENCRYPTED_KEYS) {
    if (k in patch) {
      ;(next as Record<string, unknown>)[`${k}Enc`] = encrypt(
        (patch as Record<string, string | null | undefined>)[k]
      )
    }
  }
  for (const [k, v] of Object.entries(next)) {
    ;(store as unknown as { set(k: string, v: unknown): void }).set(k, v)
  }
  return getSettings()
}
