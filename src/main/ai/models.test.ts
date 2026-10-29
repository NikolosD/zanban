import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, PROVIDER_MODEL_DEFAULTS, type AppSettings } from '../../shared/types.js'

// vi.hoisted is lifted above imports — keep it dependency-free. The cast
// gives every access a stable AppSettings type without sprinkling `!` at
// each call site; beforeEach guarantees a real value before any test runs.
const mockSettings = vi.hoisted(() => ({ value: {} as AppSettings }))
vi.mock('../settings.js', () => ({
  getSettings: () => mockSettings.value
}))
const listing = vi.hoisted(() => ({ list: async (): Promise<string[]> => [] }))
vi.mock('../providers/registry.js', () => ({
  getLlmProviderById: () => ({ listModels: () => listing.list() })
}))

const {
  modelFor,
  fastMaxOutputTokens,
  availableModel,
  FAST_MAX_OUTPUT_TOKENS,
  DETAILED_MAX_OUTPUT_TOKENS
} = await import('./models.js')
const { setGatewayCatalogForTest } = await import('./gatewayCatalog.js')
const { refreshModels, resetModelListsForTest } = await import('./providerModels.js')

describe('modelFor', () => {
  beforeEach(() => {
    mockSettings.value = { ...DEFAULT_SETTINGS, aiModels: {} }
  })

  it('falls back to per-provider defaults when no override is set', () => {
    mockSettings.value = { ...mockSettings.value, llmProvider: 'anthropic' }
    expect(modelFor('fast')).toBe(PROVIDER_MODEL_DEFAULTS.anthropic.fast)
    expect(modelFor('filter')).toBe(PROVIDER_MODEL_DEFAULTS.anthropic.filter)
    expect(modelFor('summary')).toBe(PROVIDER_MODEL_DEFAULTS.anthropic.summary)
  })

  it('honors a user override on the active provider', () => {
    mockSettings.value = {
      ...mockSettings.value,
      llmProvider: 'openai',
      aiModels: { openai: { fast: 'custom-model', filter: '', summary: '', vision: '' } }
    }
    expect(modelFor('fast')).toBe('custom-model')
    // Empty string should fall through to default — empty doesn't mean "use empty".
    expect(modelFor('filter')).toBe(PROVIDER_MODEL_DEFAULTS.openai.filter)
  })

  it('ignores whitespace-only overrides', () => {
    mockSettings.value = {
      ...mockSettings.value,
      llmProvider: 'groq',
      aiModels: { groq: { fast: '   ', filter: '', summary: '', vision: '' } }
    }
    expect(modelFor('fast')).toBe(PROVIDER_MODEL_DEFAULTS.groq.fast)
  })

  it('looks up vision in the visionProvider bucket when override is set', () => {
    mockSettings.value = {
      ...mockSettings.value,
      llmProvider: 'vercel-gateway',
      visionProvider: 'google-gemini',
      aiModels: {}
    }
    expect(modelFor('vision')).toBe(PROVIDER_MODEL_DEFAULTS['google-gemini'].vision)
  })

  it('respects vision override on the visionProvider, not the text provider', () => {
    mockSettings.value = {
      ...mockSettings.value,
      llmProvider: 'vercel-gateway',
      visionProvider: 'anthropic',
      aiModels: {
        anthropic: { fast: '', filter: '', summary: '', vision: 'claude-vision-special' },
        'vercel-gateway': { fast: '', filter: '', summary: '', vision: 'should-not-win' }
      }
    }
    expect(modelFor('vision')).toBe('claude-vision-special')
  })

  it('switching provider swaps which override bucket applies', () => {
    mockSettings.value = {
      ...mockSettings.value,
      llmProvider: 'anthropic',
      aiModels: {
        anthropic: { fast: 'a-fast', filter: '', summary: '', vision: '' },
        openai: { fast: 'o-fast', filter: '', summary: '', vision: '' }
      }
    }
    expect(modelFor('fast')).toBe('a-fast')
    mockSettings.value = { ...mockSettings.value, llmProvider: 'openai' }
    expect(modelFor('fast')).toBe('o-fast')
  })
})

describe('fastMaxOutputTokens', () => {
  it('uses the brief cap when detailed answers are off', () => {
    expect(fastMaxOutputTokens(false)).toBe(FAST_MAX_OUTPUT_TOKENS)
  })

  it('raises the cap when detailed answers are on', () => {
    expect(fastMaxOutputTokens(true)).toBe(DETAILED_MAX_OUTPUT_TOKENS)
    expect(DETAILED_MAX_OUTPUT_TOKENS).toBeGreaterThan(FAST_MAX_OUTPUT_TOKENS)
  })
})

describe('availableModel', () => {
  beforeEach(() => {
    mockSettings.value = { ...DEFAULT_SETTINGS, anthropicApiKey: 'sk-ant-a' }
    resetModelListsForTest()
  })

  it("swaps a model the gateway catalog dropped for the role's default", () => {
    setGatewayCatalogForTest([
      { id: 'anthropic/claude-haiku-5.5', type: 'language' },
      { id: 'openai/gpt-6.1-terra', type: 'language' }
    ])
    expect(availableModel('vercel-gateway', 'anthropic/claude-haiku-5.5', 'fast')).toBe(
      'anthropic/claude-haiku-5.5'
    )
    expect(availableModel('vercel-gateway', 'openai/gpt-4o', 'fast')).toBe('openai/gpt-6.1-terra')
  })

  it('checks a direct provider against its list once the list has loaded', async () => {
    listing.list = async () => ['claude-haiku-5-5', 'claude-haiku-4-5-20251001']
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-3-haiku')
    await refreshModels('anthropic')
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-haiku-5-5')
    // A plain id is an alias of its dated snapshot.
    expect(availableModel('anthropic', 'claude-haiku-4-5', 'fast')).toBe('claude-haiku-4-5')
  })

  it('falls back to the first curated model still listed when the default is gone too', async () => {
    listing.list = async () => ['claude-sonnet-4-6']
    await refreshModels('anthropic')
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-sonnet-4-6')
  })

  it('ignores a list loaded for a key the user has since replaced', async () => {
    listing.list = async () => ['claude-haiku-5-5']
    await refreshModels('anthropic')
    mockSettings.value = { ...mockSettings.value, anthropicApiKey: 'sk-ant-b' }
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-3-haiku')
  })

  it('swaps nothing when the list comes back empty or fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    listing.list = async () => []
    await refreshModels('anthropic')
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-3-haiku')

    resetModelListsForTest()
    listing.list = async () => {
      throw new Error('403 missing scope')
    }
    await refreshModels('anthropic')
    expect(availableModel('anthropic', 'claude-3-haiku', 'fast')).toBe('claude-3-haiku')
  })
})
