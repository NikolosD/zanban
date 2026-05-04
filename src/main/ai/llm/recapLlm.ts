import type { TranscriptSegment } from '../../../shared/types.js'
import { generateOneShot } from './baseLlm.js'

const SYSTEM = `You are a meeting recap writer. Produce a concise structured recap in clean Markdown:
## Summary
A 2-3 sentence overview.

## Decisions
Bulleted list of explicit decisions made. If none, write "None".

## Action items
Bulleted list of "[Owner] action — by when" if mentioned. If none, write "None".

## Open questions
Anything left unresolved.

Match the language of the transcript. Be terse.`

export async function recap(segments: TranscriptSegment[]): Promise<string> {
  const transcript = segments
    .filter((s) => s.isFinal)
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')
  if (!transcript.trim()) return ''
  return generateOneShot({
    role: 'summary',
    system: SYSTEM,
    prompt: transcript,
    temperature: 0.3,
    maxOutputTokens: 1200
  })
}
