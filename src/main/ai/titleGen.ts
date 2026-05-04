import { createGateway } from '@ai-sdk/gateway'
import { generateText } from 'ai'
import { getSettings } from '../settings.js'
import type { TranscriptSegment } from '../../shared/types.js'
import { modelFor } from './models.js'

// Kept in its own module so sessionSync can call it without creating an import
// cycle through aiGatewayClient (which itself imports recordAiExchange from
// sessionSync).
export async function generateSessionTitle(
  segments: TranscriptSegment[]
): Promise<string | null> {
  const settings = getSettings()
  if (!settings.vercelApiKey) return null
  const text = segments
    .filter((s) => s.isFinal)
    .slice(0, 60)
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')
    .slice(0, 4000)
  if (!text) return null
  try {
    const gw = createGateway({ apiKey: settings.vercelApiKey })
    const { text: out } = await generateText({
      model: gw(modelFor('summary')),
      system:
        'Summarize the meeting topic in a short title (max 60 characters). Output only the title — no quotes, no preamble. Match the language of the transcript.',
      prompt: text,
      temperature: 0.3,
      maxOutputTokens: 40
    })
    const cleaned = out.trim().replace(/^["'`]+|["'`]+$/g, '')
    return cleaned.slice(0, 80) || null
  } catch (err) {
    console.warn('[ai] generateSessionTitle failed', err)
    return null
  }
}
