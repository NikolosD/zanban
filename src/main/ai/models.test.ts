import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, PROVIDER_MODEL_DEFAULTS, type AppSettings } from '../../shared/types.js'

// vi.hoisted is lifted above imports — keep it dependency-free. The cast
// gives every access a stable AppSettings type without sprinkling `!` at
// each call site; beforeEach guarantees a real value before any test runs.
const mockSettings = vi.hoisted(() => ({ value: {} as AppSettings }))
vi.mock('../settings.js', () => ({
  getSettings: () => mockSettings.value
}))

const {
  modelFor,
  fastMaxOutputTokens,
  gatewayCallOptions,
  availableGatewayModel,
  FAST_MAX_OUTPUT_TOKENS,
  DETAILED_MAX_OUTPUT_TOKENS
} = await import('./models.js')
const { setGatewayCatalogForTest } = await import('./gatewayCatalog.js')

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

describe('gatewayCallOptions', () => {
  beforeEach(() => {
    setGatewayCatalogForTest([
      {
        id: 'openai/gpt-6.1-terra',
        temperature: true,
        reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium'] }]
      },
      {
        id: 'anthropic/claude-haiku-5.5',
        temperature: false,
        reasoning_options: [{ type: 'effort', values: ['none', 'low'] }]
      },
      {
        id: 'anthropic/claude-sonnet-5.5',
        temperature: false,
        reasoning_options: [{ type: 'effort', values: ['low', 'medium'] }]
      },
      { id: 'xiaomi/mimo-v2.6-flash', temperature: true }
    ])
  })

  it('turns reasoning off where the model allows it', () => {
    expect(gatewayCallOptions('openai/gpt-6.1-terra', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'none' } }
    })
    expect(gatewayCallOptions('anthropic/claude-haiku-5.5', 0.4)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
    })
  })

  it('falls back to the lowest effort and drops a temperature the model rejects', () => {
    expect(gatewayCallOptions('anthropic/claude-sonnet-5.5', 0.3)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { effort: 'low' } }
    })
    expect(gatewayCallOptions('xiaomi/mimo-v2.6-flash', 0.3)).toEqual({
      temperature: 0.3,
      providerOptions: undefined
    })
  })

  it('sets up the default models right before the catalog has loaded', () => {
    setGatewayCatalogForTest(null)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    expect(gatewayCallOptions('openai/gpt-6.1-terra', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'none' } }
    })
    expect(gatewayCallOptions('anthropic/claude-haiku-5.5', 0.4)).toEqual({
      temperature: undefined,
      providerOptions: { anthropic: { thinking: { type: 'disabled' } } }
    })
    expect(gatewayCallOptions('openai/gpt-oss-120b', 0.4)).toEqual({
      temperature: 0.4,
      providerOptions: { openai: { reasoningEffort: 'low' } }
    })
    vi.unstubAllGlobals()
  })
})

describe('availableGatewayModel', () => {
  it("swaps a model the catalog dropped for the role's default", () => {
    setGatewayCatalogForTest([{ id: 'anthropic/claude-haiku-5.5' }, { id: 'openai/gpt-6.1-terra' }])
    expect(availableGatewayModel('anthropic/claude-haiku-5.5', 'fast')).toBe(
      'anthropic/claude-haiku-5.5'
    )
    expect(availableGatewayModel('openai/gpt-4o', 'fast')).toBe('openai/gpt-6.1-terra')
  })

  it('swaps nothing before the catalog has loaded', () => {
    setGatewayCatalogForTest(null)
    expect(availableGatewayModel('openai/gpt-4o', 'fast')).toBe('openai/gpt-4o')
  })
})
