import type { SessionDetailPayload } from '../../../shared/api.js'
import type { RecapOptions, RecapTone, RecapLanguage } from './recapSchema.js'

export const PROMPT_VERSION = 1

const TONE_HINT: Record<RecapTone, string> = {
  concise: 'Keep the follow-up draft concise — no fluff, no greetings beyond a one-line opener.',
  friendly: 'Make the follow-up draft warm and friendly while staying professional.',
  formal: 'Keep the follow-up draft formal, polished, and business-appropriate.'
}

const LANGUAGE_HINT: Record<Exclude<RecapLanguage, 'auto'>, string> = {
  en: 'Respond in English regardless of the transcript language.',
  ru: 'Respond in Russian regardless of the transcript language.'
}

export interface RecapPromptParts {
  system: string
  user: string
}

export function buildRecapPrompt(
  session: SessionDetailPayload,
  options: RecapOptions
): RecapPromptParts {
  const tone = options.tone ?? 'concise'
  const language = options.language ?? 'auto'

  const system = [
    'You are a meeting recap writer. Read the transcript and produce a structured recap.',
    'OUTPUT FORMAT: emit a single JSON object — no prose, no markdown fencing — that matches this schema:',
    '{',
    '  "tldr": string (1-2 sentences summarising the call),',
    '  "decisions": string[] (explicit decisions; empty array if none),',
    '  "actionItems": Array<{ "text": string, "owner": "you" | "them" | "unknown", "dueHint"?: string }>,',
    '  "openQuestions": string[] (anything left unresolved),',
    '  "followUp": { "subject": string, "body": string } | null',
    '}',
    'Rules: "you" = the user (mic channel). "them" = the other party (system channel).',
    'If the call has no obvious follow-up to send, set followUp to null.',
    'Match the transcript language unless instructed otherwise.',
    TONE_HINT[tone],
    language === 'auto' ? '' : LANGUAGE_HINT[language]
  ]
    .filter(Boolean)
    .join('\n')

  const transcriptLines = session.segments
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')

  const exchangeLines = session.exchanges.map((e) => `Q: ${e.prompt}\nA: ${e.answer}`).join('\n\n')

  const userParts = [`<transcript>\n${transcriptLines || '(empty transcript)'}\n</transcript>`]
  if (exchangeLines) {
    userParts.push(`<exchanges>\n${exchangeLines}\n</exchanges>`)
  }
  if (session.title) {
    userParts.push(`<meeting_title>${session.title}</meeting_title>`)
  }

  return { system, user: userParts.join('\n\n') }
}
