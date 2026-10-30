import type { TranscriptSegment } from './types.js'

const MIN_QUESTION_WORDS = 4

const SENTENCE_BREAK = /(?<=[.!?…])\s+/
const ASKING_END = /\?[!?.…"'»”)]*$/
const STATING_END = /[.!…]["'»”)]*$/

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/**
 * The last sentence of `text` that ends in "?" and is long enough to search on.
 * Retrieval and auto-answer both take their question from here, so a punctuated
 * question can't mean one thing to the search and another to the detector.
 */
export function lastQuestion(text: string): string | null {
  const sentences = text.split(SENTENCE_BREAK)
  for (let i = sentences.length - 1; i >= 0; i--) {
    const sentence = sentences[i]!
    if (ASKING_END.test(sentence) && wordCount(sentence) >= MIN_QUESTION_WORDS) return sentence
  }
  return null
}

const wordSet = (source: string): Set<string> => new Set(source.split(' '))

const LEADING_FILLERS = wordSet(
  'um uh uhm er erm hmm mm ah oh okay ok so well like yeah yep right alright sure actually basically and but also then now anyway ну э эм ээ мм ага угу да ок окей ладно хорошо значит короче типа так вот и а но тогда итак'
)

const phrase = (source: string): RegExp => new RegExp(`^(?:${source})(?: |$)`, 'u')

// "Can you hear me?" opens every call and answering it is noise.
const CALL_CHECK_INS = [
  phrase('(?:can|could|do|did) you (?:hear|see) (?:me|us|my screen|the screen|this|that)'),
  phrase('(?:do|does|did) (?:that|this|it) make sense'),
  phrase('(?:is|was) (?:that|this|it) (?:clear|ok|okay|fine|good)'),
  phrase('you know what i'),
  phrase('see what i mean'),
  phrase('(?:do|did) you (?:get|follow) (?:me|it|that|what i)'),
  phrase('(?:are )?you (?:still )?(?:there|with me)'),
  phrase("how(?:'s| is| are) (?:you|it going|everything|things|your (?:day|week|morning|weekend))"),
  phrase('(?:вы )?(?:меня |нас )?(?:слышите|видите)'),
  phrase('(?:вам |мне )?(?:меня |нас )?(?:слышно|видно)'),
  phrase('(?:мой |наш )?экран (?:виден|видно|видите)'),
  phrase('(?:вам )?(?:все )?(?:понятно|ясно)'),
  phrase('вы меня понимаете'),
  phrase('как (?:ваши |у вас |твои |у тебя )?дела'),
  phrase('как (?:вы )?(?:поживаете|себя чувствуете)'),
  phrase('вы (?:еще )?(?:здесь|тут|на связи|со мной)')
]

const EN_WH = wordSet(
  "what why how when where who whom whose which what's why's how's when's where's who's what're who're"
)
const EN_AUX = wordSet(
  'do does did is are was were can could would will should shall have has had may might am'
)
const EN_SUBJECTS = wordSet(
  'you i we they he she it there your my our their anyone anybody everyone this that these those the'
)
const EN_IMPERATIVE_DO = wordSet('it this that these those the')
// "what I mean", "when we ship": a clause, not a question.
const EN_CLAUSE_SUBJECTS = wordSet('i we you they he she a an')
const EN_HOW_FOLLOW = wordSet('many much long often far about soon big old come else')

const RU_WH = wordSet(
  'что кто как какой какая какое какие каких каким какую какому какого где куда откуда когда почему зачем сколько чей чья чье чьи чем кому кого отчего насколько неужели разве'
)
// "что ж", "как правило", "где-то": the word is an idiom, not a question.
const RU_IDIOM_FOLLOW = wordSet(
  'ж же бы только раз правило обычно известно уже и касается до то нибудь либо ни'
)
const RU_CLAUSE_SUBJECTS = wordSet('я мы')
const RU_REQUEST_OPENERS = wordSet('можете можешь сможете сможешь расскажете')

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[’‘`´]/g, "'")
      .match(/[\p{L}\p{N}]+(?:'\p{L}+)?/gu) ?? []
  )
}

function withoutLeadingFillers(tokens: string[]): string[] {
  let start = 0
  while (start < tokens.length && LEADING_FILLERS.has(tokens[start]!)) start++
  return tokens.slice(start)
}

function opensWithEnglishQuestion(words: string[]): boolean {
  const [first = '', second = ''] = words
  if (EN_WH.has(first)) {
    if (EN_CLAUSE_SUBJECTS.has(second)) return false
    return (
      first.includes("'") ||
      EN_HOW_FOLLOW.has(second) ||
      words.slice(1, 4).some((w) => EN_AUX.has(w))
    )
  }
  if (first === 'do' && EN_IMPERATIVE_DO.has(second)) return false
  return EN_AUX.has(first) && EN_SUBJECTS.has(second)
}

function opensWithRussianQuestion(words: string[]): boolean {
  const [first = '', second = ''] = words
  if (RU_WH.has(first)) return !RU_IDIOM_FOLLOW.has(second) && !RU_CLAUSE_SUBJECTS.has(second)
  return RU_REQUEST_OPENERS.has(first) || words.slice(1, 3).includes('ли')
}

/**
 * The question the other side just asked, if the last sentence of what they
 * said is one: it ends in "?", or has no closing punctuation and opens with a
 * question word. Null for statements, fillers, interjections shorter than
 * MIN_QUESTION_WORDS ("ok?", "да?") and call check-ins ("can you hear me?").
 */
export function findQuestion(utterance: string): string | null {
  const sentence = utterance.trim().split(SENTENCE_BREAK).at(-1) ?? ''
  const words = withoutLeadingFillers(tokenize(sentence))
  if (words.length < MIN_QUESTION_WORDS) return null
  const spoken = words.join(' ')
  if (CALL_CHECK_INS.some((re) => re.test(spoken))) return null
  if (ASKING_END.test(sentence)) return lastQuestion(sentence)
  // Punctuation from the speech recognizer beats guessing from the first word;
  // the opener is only a fallback for text that arrives unpunctuated.
  if (STATING_END.test(sentence)) return null
  return opensWithEnglishQuestion(words) || opensWithRussianQuestion(words) ? sentence : null
}

/** Stable across punctuation, casing and leading fillers, so a repeat is recognised. */
export function questionKey(question: string): string {
  return withoutLeadingFillers(tokenize(question)).join(' ')
}

/** The latest thing the other side said, once the recognizer committed it. */
export function lastSystemFinal(
  finals: readonly TranscriptSegment[]
): TranscriptSegment | undefined {
  for (let i = finals.length - 1; i >= 0; i--) {
    const s = finals[i]!
    if (s.channel === 'system' && s.text.trim().length > 0) return s
  }
  return undefined
}

/**
 * Everything the other side said after segment `afterId` (all of it when null or
 * gone), joined the way retrieval joins it, so a question the recognizer split
 * across segments is read whole.
 */
export function systemSpeechSince(
  finals: readonly TranscriptSegment[],
  afterId: string | null
): { text: string; lastId: string } | null {
  const spoken = finals
    .slice(afterId === null ? 0 : finals.findIndex((s) => s.id === afterId) + 1)
    .filter((s) => s.channel === 'system' && s.text.trim().length > 0)
  const last = spoken.at(-1)
  return last ? { text: spoken.map((s) => s.text.trim()).join(' '), lastId: last.id } : null
}
