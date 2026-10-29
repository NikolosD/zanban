import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types.js'
import { answerProviderId, backupProviderIds, webSearchAllowed } from './answerRouting.js'

const cloud: AppSettings = {
  ...DEFAULT_SETTINGS,
  llmProvider: 'vercel-gateway',
  sttProvider: 'elevenlabs',
  visionProvider: 'anthropic',
  llmFallbackOrder: ['anthropic', 'ollama', 'openai'],
  autoWebSearch: true
}
const privateSetup: AppSettings = { ...cloud, llmProvider: 'ollama', sttProvider: 'local-whisper' }

describe('answer routing', () => {
  it('uses the vision override for screenshots, and the main provider otherwise', () => {
    expect(answerProviderId(cloud, true)).toBe('anthropic')
    expect(answerProviderId(cloud, false)).toBe('vercel-gateway')
  })

  it('tries every backup in order outside privacy mode', () => {
    expect(backupProviderIds(cloud, 'vercel-gateway')).toEqual(['anthropic', 'ollama', 'openai'])
    expect(webSearchAllowed(cloud)).toBe(true)
  })

  it('keeps everything on this computer in privacy mode', () => {
    expect(answerProviderId(privateSetup, true)).toBe('ollama')
    expect(backupProviderIds(privateSetup, 'ollama')).toEqual([])
    expect(webSearchAllowed(privateSetup)).toBe(false)
  })

  it('lets cloud backups answer in privacy mode once the user allows it', () => {
    const allowed = { ...privateSetup, privacyCloudFallback: true }
    expect(backupProviderIds(allowed, 'ollama')).toEqual(['anthropic', 'openai'])
    // The switch is about backups only: screenshots and web search stay local.
    expect(answerProviderId(allowed, true)).toBe('ollama')
    expect(webSearchAllowed(allowed)).toBe(false)
  })

  it('treats a cloud provider as the end of privacy mode, whatever the old flag says', () => {
    const stale = { ...cloud, privacyMode: true }
    expect(backupProviderIds(stale, 'vercel-gateway')).toEqual(['anthropic', 'ollama', 'openai'])
  })
})
