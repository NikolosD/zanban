import { z } from 'zod'

export const RECAP_SCHEMA_VERSION = 1

const recapItemSchema = z.object({
  text: z.string().min(1),
  owner: z.enum(['you', 'them', 'unknown']).default('unknown'),
  dueHint: z.string().min(1).optional()
})

const followUpSchema = z
  .object({
    subject: z.string().min(1),
    body: z.string().min(1)
  })
  .nullable()

export const recapSchema = z.object({
  tldr: z.string().min(1),
  decisions: z.array(z.string().min(1)).default([]),
  actionItems: z.array(recapItemSchema).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
  followUp: followUpSchema
})

export type RecapCore = z.infer<typeof recapSchema>

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

export interface RecapPayload extends RecapCore {
  schemaVersion: typeof RECAP_SCHEMA_VERSION
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
