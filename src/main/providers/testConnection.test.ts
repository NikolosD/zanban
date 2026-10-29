import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  error: new Error(''),
  settings: {} as Record<string, string | null>,
  getAccessToken: async (): Promise<string> => 'token',
  closed: 0
}))

vi.mock('../settings.js', () => ({ getSettings: () => ({ vercelApiKey: 'vck_x', ...h.settings }) }))
vi.mock('../services/ollamaManager.js', () => ({ checkOllama: async () => ({ running: false }) }))
vi.mock('./registry.js', () => ({
  getLlmProviderById: () => ({
    generate: async () => {
      throw h.error
    }
  })
}))
vi.mock('@google-cloud/speech', () => ({
  v2: {
    SpeechClient: class {
      auth = { getAccessToken: () => h.getAccessToken() }
      async close() {
        h.closed += 1
      }
    }
  }
}))

const { testProviderConnection, testSttConnection } = await import('./testConnection.js')

function respond(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const fetchMock = vi.fn(async () => new Response(text, { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  h.settings = {}
})

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

describe('testSttConnection', () => {
  it('asks ElevenLabs for the account with the saved key', async () => {
    h.settings = { elevenlabsApiKey: 'sk_good' }
    const fetchMock = respond(200, { subscription: {} })
    expect(await testSttConnection('elevenlabs')).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/user',
      expect.objectContaining({ headers: { 'xi-api-key': 'sk_good' } })
    )
  })

  it('flags a key ElevenLabs rejects, but accepts one limited to speech-to-text', async () => {
    h.settings = { elevenlabsApiKey: 'sk_x' }
    respond(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } })
    expect(await testSttConnection('elevenlabs')).toEqual({
      ok: false,
      message: 'Invalid API key',
      reason: 'invalid_key'
    })

    respond(401, { detail: { status: 'missing_permissions', message: 'missing user_read' } })
    expect(await testSttConnection('elevenlabs')).toEqual({ ok: true })
  })

  it("checks a Deepgram key against Deepgram's token endpoint", async () => {
    h.settings = { deepgramApiKey: 'dg_bad' }
    const fetchMock = respond(401, 'Invalid credentials.')
    expect(await testSttConnection('deepgram')).toEqual({
      ok: false,
      message: 'Invalid credentials.',
      reason: 'invalid_key'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/auth/token',
      expect.objectContaining({ headers: { Authorization: 'Token dg_bad' } })
    )
  })

  it('reports a missing key without calling out', async () => {
    const fetchMock = respond(200, {})
    expect(await testSttConnection('deepgram')).toEqual({ ok: false, message: 'No API key set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gets a Google token from the service account and closes the client', async () => {
    h.settings = {
      googleProjectId: 'proj',
      googleServiceAccountJson: JSON.stringify({ client_email: 'a@b', private_key: 'k' })
    }
    h.closed = 0
    h.getAccessToken = async () => 'token'
    expect(await testSttConnection('google')).toEqual({ ok: true })
    expect(h.closed).toBe(1)

    // What Google answers for someone else's key and for a key cut short.
    for (const message of [
      'invalid_grant: Invalid grant: account not found',
      'error:1E08010C:DECODER routines::unsupported'
    ]) {
      h.getAccessToken = async () => {
        throw new Error(message)
      }
      expect(await testSttConnection('google')).toEqual({
        ok: false,
        message,
        reason: 'invalid_key'
      })
    }
  })

  it('flags a Google service account JSON that was cut short', async () => {
    h.settings = { googleProjectId: 'proj', googleServiceAccountJson: '{"client_email": "a@b"' }
    expect(await testSttConnection('google')).toMatchObject({ ok: false, reason: 'invalid_key' })
  })

  it('needs no key for on-device recognition', async () => {
    expect(await testSttConnection('local-whisper')).toEqual({ ok: true })
  })
})
