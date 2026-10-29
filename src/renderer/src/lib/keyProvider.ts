import type { LlmProvider } from '@shared/types'
import { redactSecret, redactedSecretMask } from '@shared/settingsBoundary'

export type KeyProvider = Exclude<LlmProvider, 'ollama'> | 'elevenlabs' | 'tavily'

export type KeySettingsField =
  | 'vercelApiKey'
  | 'anthropicApiKey'
  | 'openaiApiKey'
  | 'googleAiApiKey'
  | 'groqApiKey'
  | 'elevenlabsApiKey'
  | 'tavilyApiKey'

export const KEY_SETTINGS_FIELD: Record<KeyProvider, KeySettingsField> = {
  'vercel-gateway': 'vercelApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  'google-gemini': 'googleAiApiKey',
  groq: 'groqApiKey',
  elevenlabs: 'elevenlabsApiKey',
  tavily: 'tavilyApiKey'
}

// Only shapes no other provider shares. A bare `sk-` key is deliberately absent:
// OpenAI, DeepSeek, Moonshot and others all issue them.
const KEY_SHAPES: ReadonlyArray<readonly [KeyProvider, RegExp]> = [
  ['anthropic', /^sk-ant-/],
  // Older OpenAI keys have no prefix of their own but embed "T3BlbkFJ", base64 of "OpenAI".
  ['openai', /^sk-(?:proj|svcacct|admin)-|^sk-[\w-]*T3BlbkFJ/],
  ['groq', /^gsk_/],
  ['vercel-gateway', /^vck_/],
  ['google-gemini', /^AIza/],
  ['elevenlabs', /^sk_[\da-f]{32,}$/i],
  ['tavily', /^tvly-/]
]

// Below this a value is a prefix being typed, not a pasted key.
const MIN_KEY_LENGTH = 20

const SPACE_AND_QUOTES = /^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g

/** What a user meant to paste: surrounding whitespace and quote marks removed. */
export function cleanPastedKey(raw: string): string {
  return raw.replace(SPACE_AND_QUOTES, '')
}

/** The provider a pasted key belongs to, or null when it can't be told for sure. */
export function detectKeyProvider(raw: string): KeyProvider | null {
  const key = cleanPastedKey(raw)
  if (key.length < MIN_KEY_LENGTH || /\s/.test(key)) return null
  return KEY_SHAPES.find(([, shape]) => shape.test(key))?.[0] ?? null
}

/** "••••1234" — the same tail a saved key shows, never more. */
export function maskKey(key: string): string {
  return redactedSecretMask(redactSecret(key) ?? '')
}
