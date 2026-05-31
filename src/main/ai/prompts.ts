import type { ResponseLanguage, TranscriptSegment } from '../../shared/types.js'

const BASE_SYSTEM_PROMPT = `You are Zanban, a real-time meeting assistant. The user is in a live meeting RIGHT NOW; they will read your answer in seconds, not minutes.

Hard rules:
- Be concise but substantive. Aim for 4-7 short bullets or 2-4 sentences. Include a brief reason, example, or "why it matters" when it adds real value — don't pad just to fill space.
- Clean Markdown. No preamble like "Sure, here is…", "Great question", "I'd be happy to…".
- Match the language of the question or the transcript (English, Russian, Spanish, etc.) unless a forced response language is set.
- Never invent facts about the meeting context.
- If the transcript is ambiguous, ask one focused clarifying question instead of guessing.
- For "answer the last question" requests, produce ONLY the answer — do not quote or repeat the question.`

export function buildSystemPrompt(persona?: string, language?: ResponseLanguage): string {
  const trimmed = persona?.trim()
  const langLine = languageDirective(language)
  let out = BASE_SYSTEM_PROMPT
  if (langLine) out += `\n\n${langLine}`
  if (trimmed) {
    out += `\n\nWho the user is (persona):\n${trimmed}\n\nTailor your answers to this persona — match their seniority, vocabulary, and likely concerns.`
  }
  return out
}

const VISION_SYSTEM_PROMPT = `You are Zanban, a real-time meeting assistant. The user just attached a screenshot — your job is to ACT on what is in the image, not narrate it.

How to handle the screenshot:
- If it shows a coding problem / kata / interview prompt: give the SOLUTION — short explanation of approach, then a complete code block in the relevant language. No "I see a CodeWars kata" preamble.
- If it shows an error message, log, or stack trace: diagnose the likely cause and the fix.
- If it shows a UI / dashboard / form: tell the user what to do next or what's relevant.
- If it shows documentation or text: summarize the key actionable bits.
- Only fall back to "describe the screenshot" if the user explicitly asked you to.

Format:
- Clean Markdown. No "Here is…" / "Sure!" preamble.
- Code in fenced blocks with the language tag. Real working code, not pseudocode.
- For solutions: include the code, then 1-3 short bullets on why it works / edge cases. Keep it tight but complete.
- Match the user's language (English / Russian / etc.) unless a forced response language is set.`

export function buildVisionSystemPrompt(
  persona?: string,
  language?: ResponseLanguage,
  uiLocale: 'en' | 'ru' = 'en'
): string {
  const trimmed = persona?.trim()
  const langLine = languageDirective(language)
  let out = VISION_SYSTEM_PROMPT
  if (langLine) {
    out += `\n\n${langLine}`
  } else if (uiLocale !== 'en') {
    // 'auto' has no typed question or transcript to match on a one-shot
    // screenshot, so it used to default to English (the language of the
    // screenshot / prompt template). Anchor the prose to the user's app
    // language instead; code and quoted source stay verbatim.
    out += `\n\nDefault response language: write your explanation in ${uiLocaleName(uiLocale)}, even when the screenshot or the request template is in English. Keep all code, code identifiers, error messages, and quoted source verbatim. Switch only if the user typed their own question in another language.`
  }
  if (trimmed) {
    out += `\n\nWho the user is (persona):\n${trimmed}\n\nMatch their seniority and vocabulary.`
  }
  return out
}

function uiLocaleName(uiLocale: 'en' | 'ru'): string {
  return uiLocale === 'ru' ? 'Russian (Русский)' : 'English'
}

function languageDirective(language?: ResponseLanguage): string | null {
  if (!language || language === 'auto') return null
  const name: Record<Exclude<ResponseLanguage, 'auto'>, string> = {
    en: 'English',
    ru: 'Russian (Русский)',
    es: 'Spanish (Español)',
    de: 'German (Deutsch)',
    fr: 'French (Français)',
    it: 'Italian (Italiano)',
    pt: 'Portuguese (Português)',
    ja: 'Japanese (日本語)',
    ko: 'Korean (한국어)',
    zh: 'Chinese (中文)'
  }
  return `Forced response language: write the answer in ${name[language]}, even if the question or screenshot is in another language. Keep code, code identifiers, error messages, and quoted source verbatim.`
}

export interface BuildPromptArgs {
  userPrompt: string
  meetingContext: string
  segments: TranscriptSegment[]
  contextSeconds: number
  exchanges?: Array<{ prompt: string; answer: string }>
  /** OCR text from an attached screenshot, if any. */
  ocrText?: string
  /**
   * Pre-rendered block of retrieved fragments from prior sessions, reference
   * documents, and recaps (RAG). Already wrapped in a `<retrieved_context>` tag
   * (plus any appended web-search block) — pass it through verbatim. Reference
   * documents are NO LONGER dumped wholesale here; only the relevant retrieved
   * fragments make it into the prompt.
   */
  retrievedHistory?: string
}

export function buildUserPrompt(args: BuildPromptArgs): string {
  const cutoff = Date.now() - args.contextSeconds * 1000
  const recent = args.segments.filter((s) => s.isFinal && s.createdAt >= cutoff).slice(-200)

  const transcript = recent.length
    ? recent.map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`).join('\n')
    : '(no transcript yet)'

  const contextBlock = args.meetingContext.trim()
    ? `\n\n<meeting_context>\n${args.meetingContext.trim()}\n</meeting_context>`
    : ''

  const exchangeBlock =
    args.exchanges && args.exchanges.length > 0
      ? `\n\n<previous_exchanges>\nThese are the most recent Q&A turns this session. Use them to avoid repeating yourself and to stay coherent.\n${args.exchanges
          .map((e, i) => `--- exchange ${i + 1} ---\nQ: ${e.prompt}\nA: ${e.answer}`)
          .join('\n')}\n</previous_exchanges>`
      : ''

  const ocrBlock =
    args.ocrText && args.ocrText.trim().length > 0
      ? `\n\n<screen_ocr>\nText extracted from the attached screenshot (OCR):\n${args.ocrText.trim()}\n</screen_ocr>`
      : ''

  const retrievedBlock = args.retrievedHistory ?? ''

  return `<recent_transcript>\n${transcript}\n</recent_transcript>${contextBlock}${retrievedBlock}${ocrBlock}${exchangeBlock}\n\n<user_request>\n${args.userPrompt}\n</user_request>`
}
