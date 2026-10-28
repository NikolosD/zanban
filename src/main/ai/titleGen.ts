import type { TranscriptSegment } from '../../shared/types.js'
import { generateOneShot } from './llm/baseLlm.js'

const TITLE_TIMEOUT_MS = 8000

// Kept in its own module so sessionSync can call it without creating an import
// cycle through aiGatewayClient (which itself imports recordAiExchange from
// sessionSync).
export async function generateSessionTitle(segments: TranscriptSegment[]): Promise<string | null> {
  const text = segments
    .filter((s) => s.isFinal)
    .slice(0, 60)
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')
    .slice(0, 4000)
  if (!text) return null
  try {
    const out = await generateOneShot({
      role: 'summary',
      system:
        'Summarize the meeting topic in a short title (max 60 characters). Output only the title — no quotes, no preamble. Match the language of the transcript.',
      prompt: text,
      temperature: 0.3,
      maxOutputTokens: 40,
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
    })
    const cleaned = out.trim().replace(/^["'`]+|["'`]+$/g, '')
    return cleaned.slice(0, 80) || null
  } catch (err) {
    console.warn('[ai] generateSessionTitle failed', err)
    return null
  }
}
