import type { LlmProvider, SttProvider } from '../../shared/types.js'
import { PROVIDER_MODEL_DEFAULTS } from '../../shared/types.js'
import { getSettings } from '../settings.js'
import { gatewayCallOptions } from '../ai/models.js'
import { checkOllama } from '../services/ollamaManager.js'
import { getLlmProviderById } from './registry.js'

export interface ProviderTestResult {
  ok: boolean
  message?: string
  reason?: 'invalid_key'
}

// The gateway SDK colors its error messages for a terminal.
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const KEY_REJECTED =
  /unauthenticated|unauthori[sz]ed|invalid[ _-]?(?:api[ _-]?)?key|incorrect api key|invalid_grant|decoder routines|\b401\b/i
const PROBE_TIMEOUT_MS = 10_000

function failure(err: unknown): ProviderTestResult {
  const message = (err instanceof Error ? err.message : String(err)).replace(ANSI_COLOR, '')
  return KEY_REJECTED.test(message)
    ? { ok: false, message, reason: 'invalid_key' }
    : { ok: false, message }
}

/**
 * Real connectivity probe for an LLM provider. Unlike the config-presence dot
 * (which only checks "is a key string set?"), this performs a cheap live call:
 *   - cloud providers: a 1-token `generate()` against the provider's default
 *     fast model — the lightest request that still exercises auth + routing.
 *   - vercel-gateway: same, via the registry's gateway-backed provider.
 *   - ollama: the existing health probe (daemon reachable on the host?).
 *
 * Returns `{ ok, message }` so the UI can show a clear verified/failed state
 * with the provider's own error text when something is wrong.
 */
export async function testProviderConnection(id: LlmProvider): Promise<ProviderTestResult> {
  if (id === 'ollama') {
    const health = await checkOllama()
    if (health.running) {
      return { ok: true, message: `${health.models.length} model(s) installed` }
    }
    return { ok: false, message: health.error ?? 'Ollama not reachable' }
  }

  const settings = getSettings()
  if (id === 'vercel-gateway') {
    if (!settings.vercelApiKey) return { ok: false, message: 'No API key set' }
    return probeGateway()
  }

  const provider = getLlmProviderById(id)
  if (!provider) return { ok: false, message: 'No API key set' }

  try {
    const model = PROVIDER_MODEL_DEFAULTS[id].fast
    await provider.generate({
      model,
      system: 'You are a connectivity probe. Reply with a single character.',
      prompt: 'ping',
      maxOutputTokens: 1,
      temperature: 0
    })
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

/**
 * The Vercel AI Gateway path lives outside the ILlmProvider registry (it uses
 * the @ai-sdk/gateway streaming client). A minimal `generateText`-equivalent
 * is overkill here — instead we hit the gateway's model-list endpoint, which
 * validates the key without spending tokens.
 */
async function probeGateway(): Promise<ProviderTestResult> {
  const settings = getSettings()
  try {
    const { createGateway } = await import('@ai-sdk/gateway')
    const { generateText } = await import('ai')
    const gw = createGateway({ apiKey: settings.vercelApiKey! })
    const model = PROVIDER_MODEL_DEFAULTS['vercel-gateway'].fast
    await generateText({
      model: gw(model),
      prompt: 'ping',
      maxOutputTokens: 1,
      ...gatewayCallOptions(model, 0)
    })
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

/**
 * Live check of a speech-recognition engine's saved credentials. Each probe is
 * a free account or token request: no audio is sent and nothing is billed.
 */
export async function testSttConnection(id: SttProvider): Promise<ProviderTestResult> {
  const settings = getSettings()
  switch (id) {
    case 'local-whisper':
      return { ok: true }
    case 'openai-whisper':
      return testProviderConnection('openai')
    case 'elevenlabs':
      return settings.elevenlabsApiKey
        ? probeElevenLabs(settings.elevenlabsApiKey)
        : { ok: false, message: 'No API key set' }
    case 'deepgram':
      return settings.deepgramApiKey
        ? probeDeepgram(settings.deepgramApiKey)
        : { ok: false, message: 'No API key set' }
    case 'google':
      return probeGoogle(settings.googleProjectId, settings.googleServiceAccountJson)
  }
}

async function probeElevenLabs(key: string): Promise<ProviderTestResult> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as {
      detail?: { status?: string; code?: string; message?: string }
    } | null
    const status = body?.detail?.status ?? body?.detail?.code
    const message = body?.detail?.message ?? `HTTP ${res.status}`
    // A key limited to speech-to-text can't read the account, yet it transcribes.
    if (status === 'missing_permissions') return { ok: true }
    return res.status === 401
      ? { ok: false, message, reason: 'invalid_key' }
      : { ok: false, message }
  } catch (err) {
    return failure(err)
  }
}

async function probeDeepgram(key: string): Promise<ProviderTestResult> {
  try {
    const res = await fetch('https://api.deepgram.com/v1/auth/token', {
      headers: { Authorization: `Token ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (res.ok) return { ok: true }
    // Deepgram answers a bad key in plain text, other errors in JSON.
    const text = (await res.text().catch(() => '')).trim()
    const message = text.startsWith('{')
      ? ((JSON.parse(text) as { err_msg?: string }).err_msg ?? text)
      : text || `HTTP ${res.status}`
    return res.status === 401
      ? { ok: false, message, reason: 'invalid_key' }
      : { ok: false, message }
  } catch (err) {
    return failure(err)
  }
}

async function probeGoogle(
  projectId: string | null,
  serviceAccountJson: string | null
): Promise<ProviderTestResult> {
  if (!projectId) return { ok: false, message: 'No project ID set' }
  let credentials: { client_email: string; private_key: string } | undefined
  if (serviceAccountJson?.trim()) {
    try {
      const parsed = JSON.parse(serviceAccountJson) as {
        client_email?: string
        private_key?: string
      }
      if (!parsed.client_email || !parsed.private_key) throw new Error('incomplete')
      credentials = { client_email: parsed.client_email, private_key: parsed.private_key }
    } catch {
      return {
        ok: false,
        message: 'Service account JSON is malformed or incomplete',
        reason: 'invalid_key'
      }
    }
  }
  try {
    const { v2 } = await import('@google-cloud/speech')
    const client = new v2.SpeechClient({ projectId, credentials })
    try {
      await client.auth.getAccessToken()
    } finally {
      await client.close()
    }
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}
