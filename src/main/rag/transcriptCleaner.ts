import type { TranscriptSegment } from '../../shared/types.js'

/**
 * Light-weight cleanup pass for STT segments before chunking + embedding.
 *
 * Goals:
 *  - drop pure filler segments ("uh", "ну вот") that pollute embeddings;
 *  - collapse repeated tokens that ASR loves to emit ("yeah yeah yeah");
 *  - strip in-line fillers but keep meaningful content;
 *  - drop near-empty fragments after cleaning.
 *
 * Deliberately conservative: we only remove tokens we're sure are filler.
 * Bilingual (en + ru) because the app handles both.
 */

const EN_FILLERS = new Set([
  'uh',
  'um',
  'ah',
  'er',
  'erm',
  'hmm',
  'hm',
  'mm',
  'mhm',
  'uh-huh',
  'mm-hmm'
])

const RU_FILLERS = new Set([
  'э',
  'эм',
  'мм',
  'ммм',
  'ну',
  'вот',
  'это',
  'эээ',
  'ага',
  'угу'
])

const EN_MULTI_FILLERS = [
  /\byou know\b/gi,
  /\bi mean\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi
]

const RU_MULTI_FILLERS = [
  /\bкак бы\b/gi,
  /\bтипа того\b/gi,
  /\bв общем-то\b/gi,
  /\bэто самое\b/gi
]

const FILLERS = new Set<string>([...EN_FILLERS, ...RU_FILLERS])

function cleanText(input: string): string {
  let s = input.trim()
  if (!s) return ''

  for (const re of EN_MULTI_FILLERS) s = s.replace(re, '')
  for (const re of RU_MULTI_FILLERS) s = s.replace(re, '')

  // Collapse adjacent duplicate words (case-insensitive): "yeah yeah" → "yeah".
  s = s.replace(/\b(\p{L}+)(\s+\1\b)+/giu, '$1')

  // Token-level filler removal.
  const tokens = s.split(/\s+/)
  const kept: string[] = []
  for (const t of tokens) {
    const norm = t.toLowerCase().replace(/[.,!?;:()"'«»]/g, '')
    if (!norm) continue
    if (FILLERS.has(norm)) continue
    kept.push(t)
  }
  s = kept.join(' ')

  // Tidy punctuation/spacing.
  s = s.replace(/\s+([.,!?;:])/g, '$1')
  s = s.replace(/([.,!?;:]){2,}/g, '$1')
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

/** Word count heuristic — segments below this after cleaning are dropped. */
const MIN_WORDS = 3

export function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const s of segments) {
    const cleaned = cleanText(s.text)
    if (!cleaned) continue
    if (cleaned.split(/\s+/).length < MIN_WORDS) continue
    out.push({ ...s, text: cleaned })
  }
  return out
}

// Exported for unit tests / ad-hoc use.
export { cleanText }
