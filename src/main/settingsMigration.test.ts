import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types.js'

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  encryption: true
}))

vi.mock('electron-store', () => ({
  default: class {
    constructor(opts: { defaults: Record<string, unknown> }) {
      h.data = { ...opts.defaults }
    }
    get store(): Record<string, unknown> {
      return { ...h.data }
    }
    set(patch: Record<string, unknown>): void {
      Object.assign(h.data, patch)
    }
  }
}))

vi.mock('electron', () => ({
  app: { isReady: () => true },
  safeStorage: {
    isEncryptionAvailable: () => h.encryption,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const s = b.toString()
      if (!s.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext')
      return s.slice(4)
    },
    getSelectedStorageBackend: () => 'gnome_libsecret'
  }
}))

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'GOOGLE_AI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'TAVILY_API_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON'
]

function enc(value: string): string {
  return Buffer.from(`enc:${value}`).toString('base64')
}

async function loadWith(persisted: Record<string, unknown> = {}) {
  vi.resetModules()
  const mod = await import('./settings.js')
  Object.assign(h.data, persisted)
  return mod
}

beforeEach(() => {
  h.encryption = true
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('upgrading an older settings file', () => {
  it('keeps the model overrides saved in the old flat shape, under the gateway provider', async () => {
    const { getSettings } = await loadWith({
      aiModels: { fast: 'old-fast', filter: 'old-filter', summary: '', vision: 'old-vision' }
    })
    expect(getSettings().aiModels).toEqual({
      'vercel-gateway': {
        fast: 'old-fast',
        filter: 'old-filter',
        summary: '',
        vision: 'old-vision'
      }
    })
  })

  it('fills the roles an old flat entry never had with empty overrides', async () => {
    const { getSettings } = await loadWith({ aiModels: { fast: 'only-fast' } })
    expect(getSettings().aiModels['vercel-gateway']).toEqual({
      fast: 'only-fast',
      filter: '',
      summary: '',
      vision: ''
    })
  })

  it('leaves per-provider overrides exactly as saved', async () => {
    const saved = {
      anthropic: { fast: 'a', filter: 'b', summary: 'c', vision: 'd' },
      groq: { fast: 'g', filter: '', summary: '', vision: '' }
    }
    const { getSettings } = await loadWith({ aiModels: saved })
    expect(getSettings().aiModels).toEqual(saved)
  })

  it.each([[null], ['fast'], [42], [undefined]])(
    'starts with no overrides when aiModels is %j',
    async (garbage) => {
      const { getSettings } = await loadWith({ aiModels: garbage })
      expect(getSettings().aiModels).toEqual({})
    }
  )

  it('turns the old macOS-only dock flag into hide-from-app-switcher', async () => {
    const { getSettings } = await loadWith({ hideDockMacOS: true, hideFromAppSwitcher: undefined })
    expect(getSettings().hideFromAppSwitcher).toBe(true)
  })

  it('prefers the new app-switcher flag over the legacy one, even when it is false', async () => {
    const { getSettings } = await loadWith({ hideDockMacOS: true, hideFromAppSwitcher: false })
    expect(getSettings().hideFromAppSwitcher).toBe(false)
  })

  it('falls back to the default app-switcher behaviour when neither flag was ever saved', async () => {
    const { getSettings } = await loadWith({ hideFromAppSwitcher: undefined })
    expect(getSettings().hideFromAppSwitcher).toBe(DEFAULT_SETTINGS.hideFromAppSwitcher)
  })

  it('keeps a remapped hotkey and fills in hotkeys added since the file was written', async () => {
    const { getSettings } = await loadWith({ hotkeys: { askAi: 'Ctrl+Alt+K' } })
    expect(getSettings().hotkeys).toEqual({ ...DEFAULT_SETTINGS.hotkeys, askAi: 'Ctrl+Alt+K' })
  })

  it('fills in audio and recap options that older files did not have', async () => {
    const { getSettings } = await loadWith({
      audio: { micDeviceId: 'usb-headset' },
      recap: { tone: 'formal' }
    })
    expect(getSettings().audio).toEqual({ ...DEFAULT_SETTINGS.audio, micDeviceId: 'usb-headset' })
    expect(getSettings().recap).toEqual({ ...DEFAULT_SETTINGS.recap, tone: 'formal' })
  })

  it('keeps every other saved choice, such as the speech provider and language', async () => {
    const { getSettings } = await loadWith({
      sttProvider: 'deepgram',
      transcriptionLanguage: 'ru',
      uiLocale: 'ru'
    })
    expect(getSettings()).toMatchObject({
      sttProvider: 'deepgram',
      transcriptionLanguage: 'ru',
      uiLocale: 'ru'
    })
  })
})

describe('stored API keys', () => {
  it('survives a key that can no longer be decrypted, without losing the other keys', async () => {
    const { getSettings } = await loadWith({
      anthropicApiKeyEnc: Buffer.from('written-by-another-os-user').toString('base64'),
      openaiApiKeyEnc: enc('sk-openai')
    })
    const settings = getSettings()
    expect(settings.anthropicApiKey).toBeNull()
    expect(settings.openaiApiKey).toBe('sk-openai')
  })

  it('falls back to an environment key only when nothing usable is stored', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-from-env')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-env')
    const { getSettings } = await loadWith({ openaiApiKeyEnc: enc('sk-openai-stored') })
    const settings = getSettings()
    expect(settings.anthropicApiKey).toBe('sk-from-env')
    expect(settings.openaiApiKey).toBe('sk-openai-stored')
  })

  it('uses each provider’s own environment variable', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-env')
    vi.stubEnv('GOOGLE_AI_API_KEY', 'gemini-env')
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-env')
    vi.stubEnv('DEEPGRAM_API_KEY', 'deepgram-env')
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-env')
    vi.stubEnv('TAVILY_API_KEY', 'tavily-env')
    const { getSettings } = await loadWith()
    expect(getSettings()).toMatchObject({
      groqApiKey: 'groq-env',
      googleAiApiKey: 'gemini-env',
      vercelApiKey: 'gateway-env',
      deepgramApiKey: 'deepgram-env',
      elevenlabsApiKey: 'eleven-env',
      tavilyApiKey: 'tavily-env',
      anthropicApiKey: null,
      openaiApiKey: null
    })
  })

  it('takes the Google project and credentials from the environment only as a fallback', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'env-project')
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS_JSON', '{"from":"env"}')
    const fromEnv = await loadWith()
    expect(fromEnv.getSettings()).toMatchObject({
      googleProjectId: 'env-project',
      googleServiceAccountJson: '{"from":"env"}'
    })

    const stored = await loadWith({
      googleProjectId: 'saved-project',
      googleServiceAccountJsonEnc: enc('{"from":"disk"}')
    })
    expect(stored.getSettings()).toMatchObject({
      googleProjectId: 'saved-project',
      googleServiceAccountJson: '{"from":"disk"}'
    })
  })

  it('never writes a key to disk in plaintext, even when the OS cannot encrypt it', async () => {
    h.encryption = false
    const { setSettings } = await loadWith()

    setSettings({ anthropicApiKey: 'sk-ant-secret', detectable: true })

    expect(h.data.anthropicApiKeyEnc).toBeNull()
    expect(JSON.stringify(h.data)).not.toContain('sk-ant-secret')
    expect(h.data.detectable).toBe(true)
  })

  it('leaves stored keys alone when an unrelated setting changes', async () => {
    const { getSettings, setSettings } = await loadWith({
      anthropicApiKeyEnc: enc('sk-ant-keep'),
      groqApiKeyEnc: enc('gsk-keep')
    })

    setSettings({ contextSeconds: 45 })

    expect(h.data.anthropicApiKeyEnc).toBe(enc('sk-ant-keep'))
    expect(getSettings()).toMatchObject({
      contextSeconds: 45,
      anthropicApiKey: 'sk-ant-keep',
      groqApiKey: 'gsk-keep'
    })
  })

  it('replaces only the key that was edited', async () => {
    const { getSettings, setSettings } = await loadWith({
      anthropicApiKeyEnc: enc('sk-ant-old'),
      groqApiKeyEnc: enc('gsk-keep')
    })

    setSettings({ anthropicApiKey: 'sk-ant-new' })

    expect(getSettings()).toMatchObject({ anthropicApiKey: 'sk-ant-new', groqApiKey: 'gsk-keep' })
  })
})
