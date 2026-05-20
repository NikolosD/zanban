import type { RecapPayload, RecapErrorCode } from '@shared/recap-types'
import type { TFunction } from 'i18next'

export function recapErrorMessage(code: RecapErrorCode, fallback: string, t: TFunction): string {
  const key = `session_detail.recap.error.${code}` as const
  const translated = t(key, { defaultValue: fallback })
  return translated
}

export function formatRecapAsMarkdown(recap: RecapPayload): string {
  const parts: string[] = []
  parts.push(`# TL;DR\n\n${recap.tldr}`)

  if (recap.decisions.length > 0) {
    parts.push(`## Decisions\n\n${recap.decisions.map((d) => `- ${d}`).join('\n')}`)
  }

  if (recap.actionItems.length > 0) {
    const lines = recap.actionItems.map((a) => {
      const owner = a.owner === 'you' ? 'You' : a.owner === 'them' ? 'Them' : '?'
      const due = a.dueHint ? ` — ${a.dueHint}` : ''
      return `- (${owner}) ${a.text}${due}`
    })
    parts.push(`## Action items\n\n${lines.join('\n')}`)
  }

  if (recap.openQuestions.length > 0) {
    parts.push(`## Open questions\n\n${recap.openQuestions.map((q) => `- ${q}`).join('\n')}`)
  }

  if (recap.followUp) {
    parts.push(`## Follow-up\n\n**Subject:** ${recap.followUp.subject}\n\n${recap.followUp.body}`)
  }

  return parts.join('\n\n')
}

export function formatFollowUpAsPlainText(followUp: { subject: string; body: string }): string {
  const body = stripMarkdown(followUp.body)
  return `Subject: ${followUp.subject}\n\n${body}`
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
}
