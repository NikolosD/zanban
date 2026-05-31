import type { RecapCore } from './recapSchema.js'

/**
 * Render a structured recap as a Markdown "## Recap" section. Used by the
 * session markdown export so one Export click produces a full document
 * (recap + transcript). Mirrors the renderer-side formatRecapAsMarkdown but
 * emits an H2-rooted section that slots above the existing transcript heading.
 */
export function renderRecapMarkdown(recap: RecapCore): string {
  const lines: string[] = []
  lines.push('## Recap', '')
  lines.push('### TL;DR', '')
  lines.push(recap.tldr, '')

  if (recap.actionItems.length > 0) {
    lines.push('### Action items', '')
    for (const a of recap.actionItems) {
      const owner = a.owner === 'you' ? 'You' : a.owner === 'them' ? 'Them' : '?'
      const due = a.dueHint ? ` — ${a.dueHint}` : ''
      lines.push(`- (${owner}) ${a.text}${due}`)
    }
    lines.push('')
  }

  if (recap.decisions.length > 0) {
    lines.push('### Decisions', '')
    for (const d of recap.decisions) lines.push(`- ${d}`)
    lines.push('')
  }

  if (recap.openQuestions.length > 0) {
    lines.push('### Open questions', '')
    for (const q of recap.openQuestions) lines.push(`- ${q}`)
    lines.push('')
  }

  if (recap.followUp) {
    lines.push('### Follow-up', '')
    lines.push(`**Subject:** ${recap.followUp.subject}`, '')
    lines.push(recap.followUp.body, '')
  }

  return lines.join('\n')
}

/**
 * Splice a rendered "## Recap" block into session markdown, right before the
 * "## Transcript" heading. Falls back to appending after the existing content
 * if the transcript heading is missing (older/edge-case files).
 */
export function insertRecapSection(md: string, recapMd: string): string {
  const marker = '## Transcript'
  const idx = md.indexOf(marker)
  if (idx === -1) return `${md.trimEnd()}\n\n${recapMd}`
  return `${md.slice(0, idx)}${recapMd}\n${md.slice(idx)}`
}
