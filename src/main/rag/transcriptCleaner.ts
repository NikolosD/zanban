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

const RU_FILLERS = new Set(['э', 'эм', 'мм', 'ммм', 'ну', 'вот', 'это', 'эээ', 'ага', 'угу'])

// JS `\b` only knows ASCII word characters (even with the `u` flag), so it never
// matches next to Cyrillic; letter/digit lookarounds work for both scripts.
function phrase(words: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
}

const EN_MULTI_FILLERS = ['you know', 'i mean', 'sort of', 'kind of'].map(phrase)

const RU_MULTI_FILLERS = ['как бы', 'типа того', 'в общем-то', 'это самое'].map(phrase)

const FILLERS = new Set<string>([...EN_FILLERS, ...RU_FILLERS])

function cleanText(input: string): string {
  let s = input.trim()
  if (!s) return ''

  for (const re of EN_MULTI_FILLERS) s = s.replace(re, '')
  for (const re of RU_MULTI_FILLERS) s = s.replace(re, '')

  // Collapse adjacent duplicate words (case-insensitive): "yeah yeah" → "yeah".
  s = s.replace(/(?<![\p{L}\p{N}])(\p{L}+)(?:\s+\1)+(?![\p{L}\p{N}])/giu, '$1')

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

/** Segments that lost filler and are left with fewer words than this are dropped. */
const MIN_WORDS = 3

function wordCount(s: string): number {
  return s.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

export function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const s of segments) {
    const cleaned = cleanText(s.text)
    if (!cleaned) continue
    // A short leftover of a filler-heavy segment ("ну вот да") is noise, but a
    // terse real answer ("Пятьдесят тысяч.") had nothing stripped and stays.
    const words = wordCount(cleaned)
    if (words < MIN_WORDS && words < wordCount(s.text)) continue
    out.push({ ...s, text: cleaned })
  }
  return out
}

// Exported for unit tests / ad-hoc use.
export { cleanText }
