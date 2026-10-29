import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ error: new Error('') }))

vi.mock('../settings.js', () => ({ getSettings: () => ({ vercelApiKey: 'vck_x' }) }))
vi.mock('../ai/models.js', () => ({ gatewayCallOptions: () => ({}) }))
vi.mock('../services/ollamaManager.js', () => ({ checkOllama: async () => ({ running: false }) }))
vi.mock('./registry.js', () => ({
  getLlmProviderById: () => ({
    generate: async () => {
      throw h.error
    }
  })
}))

const { testProviderConnection } = await import('./testConnection.js')

describe('testProviderConnection', () => {
  it('strips terminal colors and flags a rejected key', async () => {
    h.error = new Error(
      '\u001b[1m\u001b[31mUnauthenticated request to AI Gateway.\u001b[0m Set a key.'
    )
    expect(await testProviderConnection('anthropic')).toEqual({
      ok: false,
      message: 'Unauthenticated request to AI Gateway. Set a key.',
      reason: 'invalid_key'
    })
  })

  it('passes other failures through as they are', async () => {
    h.error = new Error('model not found')
    expect(await testProviderConnection('anthropic')).toEqual({
      ok: false,
      message: 'model not found'
    })
  })
})
