// src/shared/recap-types.ts
// Types mirrored here so renderer/preload can type IPC without importing
// main code (which the web build path config forbids — src/main is not in
// tsconfig.web.json's include list).
//
// CONST_CONSISTENCY: must match recapPrompt.ts PROMPT_VERSION
export const PROMPT_VERSION = 1
// CONST_CONSISTENCY: must match recapSchema.ts RECAP_SCHEMA_VERSION
export const RECAP_SCHEMA_VERSION = 1

export type RecapTone = 'concise' | 'friendly' | 'formal'
export type RecapLanguage = 'auto' | 'en' | 'ru'

export interface RecapOptions {
  tone?: RecapTone
  language?: RecapLanguage
  modelOverride?: string | null
}

export type RecapErrorCode =
  | 'rate_limit'
  | 'timeout'
  | 'no_provider'
  | 'invalid_output'
  | 'no_transcript'
  | 'already_generating'
  | 'unknown'

/** Structured recap content. Mirrors RecapCore from recapSchema.ts. */
export interface RecapPayload {
  // RecapCore fields
  tldr: string
  decisions: string[]
  actionItems: Array<{
    text: string
    owner: 'you' | 'them' | 'unknown'
    dueHint?: string
  }>
  openQuestions: string[]
  followUp: { subject: string; body: string } | null
  // RecapPayload fields
  schemaVersion: number
  generatedAt: number
  model: string
  promptVersion: number
  partial?: boolean
}

export type RecapResult =
  | { ok: true; recap: RecapPayload }
  | {
      ok: false
      code: RecapErrorCode
      message: string
      partial?: RecapPayload
    }

/**
 * One "owner: you" action item aggregated across every session's recap, for the
 * global Action Items panel. The renderer filters out items the user has ticked
 * off (checked state lives in localStorage, keyed by the same text hash D5 uses)
 * and links each row back to its source session.
 */
export interface GlobalActionItem {
  sessionId: string
  sessionTitle: string | null
  sessionStartedAt: number
  text: string
  dueHint?: string
}
