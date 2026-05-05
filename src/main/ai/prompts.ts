import type { ResponseLanguage, TranscriptSegment } from '../../shared/types.js'
import { getActiveContext } from '../documents/referenceStore.js'

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

export function buildVisionSystemPrompt(persona?: string, language?: ResponseLanguage): string {
  const trimmed = persona?.trim()
  const langLine = languageDirective(language)
  let out = VISION_SYSTEM_PROMPT
  if (langLine) out += `\n\n${langLine}`
  if (trimmed) {
    out += `\n\nWho the user is (persona):\n${trimmed}\n\nMatch their seniority and vocabulary.`
  }
  return out
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

export const QUESTION_EXTRACTOR_PROMPT = `You receive a short snippet from a live meeting transcript. Your job: return ONLY the actual question/request being asked, or exactly the word "NONE" if there is no real question.

What COUNTS as a real question:
- An interrogative that expects a substantive answer ("Что такое virtual DOM?", "How do you handle 80k writes/min?").
- An imperative request that is essentially a question in disguise ("Расскажи про опыт работы с XYZ", "Tell me about a time when…", "Объясни, как работает event loop").
- The interviewee/THEM is asking the speaker (YOU) to share knowledge or experience.

What does NOT count (output "NONE"):
- Transition / filler / connective phrases ("Следующий вопрос плавно продолжает предыдущий", "Давай перейдём к более глобальным вещам", "One of those questions is…").
- Hedges and incomplete fragments ("Да, ну, во…", "А ещё, я хочу спросить", "Hmm, well, so…").
- Rhetorical questions where no real answer is expected.
- Pure statements, even if they have a question-like intonation.

Output rules:
- If multiple sentences, return the LAST and most direct question/request.
- Keep the question in its original language. No quotes, no preamble, no commentary.
- A single trailing "?" is allowed but not required (imperative requests don't need it).
- If you are unsure or it is borderline, output exactly: NONE

Examples:
Input: "Следующий вопрос также связан с состоянием. Что такое virtual DOM и как он работает?"
Output: Что такое virtual DOM и как он работает?

Input: "Расскажи, какие в целом есть уязвимости с чем ты сталкивался сам?"
Output: Какие в целом есть уязвимости и с чем ты сталкивался сам?

Input: "Давай перейдём с swap pack, она уже такие более глобальные вещи."
Output: NONE

Input: "Да, ну, во"
Output: NONE

Input: "One of those questions, what's the difference between memo and useMemo?"
Output: What's the difference between memo and useMemo?

Input: "Следующий вопрос является плавным продолжением предыдущего."
Output: NONE

Input: "А ещё, я хочу спросить."
Output: NONE

Input: "Tell me about a time when you had to debug a really nasty production issue."
Output: Tell me about a time when you had to debug a really nasty production issue.`

export interface BuildPromptArgs {
  userPrompt: string
  meetingContext: string
  segments: TranscriptSegment[]
  contextSeconds: number
  exchanges?: Array<{ prompt: string; answer: string }>
  /** OCR text from an attached screenshot, if any. */
  ocrText?: string
  /**
   * Pre-rendered block of retrieved snippets from prior sessions (RAG).
   * Already wrapped in a `<retrieved_history>` tag — pass it through verbatim.
   */
  retrievedHistory?: string
}

export function buildUserPrompt(args: BuildPromptArgs): string {
  const cutoff = Date.now() - args.contextSeconds * 1000
  const recent = args.segments
    .filter((s) => s.isFinal && s.createdAt >= cutoff)
    .slice(-200)

  const transcript = recent.length
    ? recent
        .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
        .join('\n')
    : '(no transcript yet)'

  const contextBlock = args.meetingContext.trim()
    ? `\n\n<meeting_context>\n${args.meetingContext.trim()}\n</meeting_context>`
    : ''

  const referenceText = getActiveContext()
  const referenceBlock = referenceText
    ? `\n\n<reference_documents>${referenceText}\n</reference_documents>`
    : ''

  const exchangeBlock =
    args.exchanges && args.exchanges.length > 0
      ? `\n\n<previous_exchanges>\nThese are the most recent Q&A turns this session. Use them to avoid repeating yourself and to stay coherent.\n${args.exchanges
          .map((e, i) => `--- exchange ${i + 1} ---\nQ: ${e.prompt}\nA: ${e.answer}`)
          .join('\n')}\n</previous_exchanges>`
      : ''

  const ocrBlock = args.ocrText && args.ocrText.trim().length > 0
    ? `\n\n<screen_ocr>\nText extracted from the attached screenshot (OCR):\n${args.ocrText.trim()}\n</screen_ocr>`
    : ''

  const retrievedBlock = args.retrievedHistory ?? ''

  return `<recent_transcript>\n${transcript}\n</recent_transcript>${contextBlock}${referenceBlock}${retrievedBlock}${ocrBlock}${exchangeBlock}\n\n<user_request>\n${args.userPrompt}\n</user_request>`
}
