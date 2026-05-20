import type { SessionDetailPayload } from '../../../shared/api.js'
import { generateOneShot } from './baseLlm.js'
import { modelFor } from '../models.js'
import {
  recapSchema,
  RECAP_SCHEMA_VERSION,
  type RecapOptions,
  type RecapPayload,
  type RecapResult
} from '../../services/recap/recapSchema.js'
import { buildRecapPrompt, PROMPT_VERSION } from '../../services/recap/recapPrompt.js'

const TIMEOUT_MS = 60_000

export async function generateRecap(
  session: SessionDetailPayload,
  options: RecapOptions
): Promise<RecapResult> {
  if (session.segments.length === 0) {
    return { ok: false, code: 'no_transcript', message: 'No transcript to summarise.' }
  }

  const { system, user } = buildRecapPrompt(session, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let raw: string
  try {
    raw = await generateOneShot({
      role: 'summary',
      system,
      prompt: user,
      temperature: 0.3,
      maxOutputTokens: 1500,
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    if (controller.signal.aborted) return { ok: false, code: 'timeout', message }
    if (/rate.*limit|429/i.test(message)) return { ok: false, code: 'rate_limit', message }
    if (/not configured|missing api key|no provider/i.test(message))
      return { ok: false, code: 'no_provider', message }
    return { ok: false, code: 'unknown', message }
  }
  clearTimeout(timer)

  const stripped = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return { ok: false, code: 'invalid_output', message: 'Model did not return JSON.' }
  }

  const full = recapSchema.safeParse(parsed)
  if (full.success) {
    return {
      ok: true,
      recap: assemble(full.data, options.modelOverride ?? modelFor('summary'), false)
    }
  }

  // Partial-parse attempt: keep whatever the model managed to give us.
  const partial = recapSchema
    .partial({ decisions: true, actionItems: true, openQuestions: true, followUp: true })
    .safeParse(parsed)
  if (partial.success && typeof (partial.data as Record<string, unknown>).tldr === 'string') {
    return {
      ok: false,
      code: 'invalid_output',
      message: 'Some recap sections could not be parsed.',
      partial: assemble(
        {
          tldr: (partial.data as { tldr: string }).tldr,
          decisions: (partial.data as { decisions?: string[] }).decisions ?? [],
          actionItems: (partial.data as { actionItems?: never[] }).actionItems ?? [],
          openQuestions: (partial.data as { openQuestions?: string[] }).openQuestions ?? [],
          followUp: (partial.data as { followUp?: never }).followUp ?? null
        },
        options.modelOverride ?? modelFor('summary'),
        true
      )
    }
  }

  return { ok: false, code: 'invalid_output', message: 'Output did not match schema.' }
}

function assemble(
  core: import('../../services/recap/recapSchema.js').RecapCore,
  model: string,
  partial: boolean
): RecapPayload {
  return {
    ...core,
    schemaVersion: RECAP_SCHEMA_VERSION,
    generatedAt: Date.now(),
    model,
    promptVersion: PROMPT_VERSION,
    ...(partial ? { partial: true } : {})
  }
}

function stripCodeFence(s: string): string {
  // Tolerate models that wrap JSON in ```json ... ``` despite the instruction.
  const trimmed = s.trim()
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }
  return trimmed
}
