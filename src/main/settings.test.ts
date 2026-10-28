import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redactSecret } from '../shared/settingsBoundary.js'

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  reads: 0,
  ready: true,
  backend: 'gnome_libsecret'
}))

vi.mock('electron-store', () => ({
  default: class {
    constructor(opts: { defaults: Record<string, unknown> }) {
      h.data = { ...opts.defaults }
    }
    get store(): Record<string, unknown> {
      h.reads++
      return { ...h.data }
    }
    set(patch: Record<string, unknown>): void {
      Object.assign(h.data, patch)
    }
  }
}))

vi.mock('electron', () => ({
  app: { isReady: () => h.ready },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => {
      const s = b.toString()
      if (!s.startsWith('enc:')) throw new Error('not ours')
      return s.slice(4)
    },
    getSelectedStorageBackend: () => h.backend
  }
}))

const KEY = 'sk-ant-api03-abcdefgh1234'

async function load(): Promise<typeof import('./settings.js')> {
  vi.resetModules()
  return import('./settings.js')
}

describe('settings', () => {
  const platform = process.platform

  beforeEach(() => {
    h.reads = 0
    h.ready = true
    h.backend = 'gnome_libsecret'
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform })
    vi.restoreAllMocks()
  })

  it('stores keys encrypted and returns them decrypted to main', async () => {
    const { getSettings, setSettings } = await load()
    setSettings({ anthropicApiKey: KEY })
    expect(h.data.anthropicApiKeyEnc).toBe(Buffer.from(`enc:${KEY}`).toString('base64'))
    expect(h.data).not.toHaveProperty('anthropicApiKey')
    expect(getSettings().anthropicApiKey).toBe(KEY)
  })

  it('ignores a redacted marker so it never overwrites the stored key', async () => {
    const { getSettings, setSettings } = await load()
    setSettings({ anthropicApiKey: KEY })
    setSettings({ anthropicApiKey: redactSecret(KEY), contextSeconds: 30 })
    expect(getSettings().anthropicApiKey).toBe(KEY)
    expect(getSettings().contextSeconds).toBe(30)
  })

  it('clears a key on an explicit null', async () => {
    const { getSettings, setSettings } = await load()
    setSettings({ anthropicApiKey: KEY })
    setSettings({ anthropicApiKey: null })
    expect(h.data.anthropicApiKeyEnc).toBeNull()
    expect(getSettings().anthropicApiKey).toBe(process.env.ANTHROPIC_API_KEY ?? null)
  })

  it('reads the store once until a write invalidates the cache', async () => {
    const { getSettings, setSettings } = await load()
    const first = getSettings()
    expect(getSettings()).toBe(first)
    expect(h.reads).toBe(1)
    setSettings({ detectable: true })
    expect(getSettings().detectable).toBe(true)
    expect(getSettings()).toBe(getSettings())
  })

  it('does not cache reads made before app ready', async () => {
    const { getSettings } = await load()
    h.ready = false
    getSettings()
    getSettings()
    expect(h.reads).toBe(2)
  })

  it('warns once on Linux when keys are only obfuscated', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    h.backend = 'basic_text'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getSettings, setSettings } = await load()
    getSettings()
    setSettings({ detectable: true })
    getSettings()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when a real keyring backs safeStorage', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getSettings } = await load()
    getSettings()
    expect(warn).not.toHaveBeenCalled()
  })
})
