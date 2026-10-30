export interface AnswerSplit {
  /** The bold verdict line as plain text; null when the answer doesn't open with one. */
  lead: string | null
  rest: string
}

const MAX_LEAD_WORDS = 25
const MAX_LEAD_CHARS = 220
const WHOLE_BOLD = /^\*\*(.+?)\*\*[\s.!:;]*$/

function plain(text: string): string {
  return text.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()
}

function isShort(text: string): boolean {
  return text.length <= MAX_LEAD_CHARS && text.split(/\s+/).length <= MAX_LEAD_WORDS
}

/**
 * Splits off the first line when it is a short, fully bold verdict. While the
 * answer streams, a line that has opened `**` but not closed it is already the
 * lead, so the text doesn't first render as body and then jump into the slot.
 */
export function splitAnswerLead(answer: string, streaming = false): AnswerSplit {
  const text = answer.trimStart()
  const body: AnswerSplit = { lead: null, rest: answer }
  if (streaming && (text === '*' || text === '**')) return { lead: '', rest: '' }
  if (!text.startsWith('**')) return body

  const newline = text.indexOf('\n')
  const line = newline === -1 ? text : text.slice(0, newline)
  const rest = newline === -1 ? '' : text.slice(newline + 1).replace(/^\s*\n/, '')

  const whole = WHOLE_BOLD.exec(line)
  if (whole) {
    const inner = plain(whole[1]!)
    return inner && isShort(inner) ? { lead: inner, rest } : body
  }
  const stillOpen = streaming && newline === -1 && !line.slice(2).includes('**')
  if (!stillOpen) return body
  const inner = plain(line.slice(2))
  return isShort(inner) ? { lead: inner, rest: '' } : body
}
