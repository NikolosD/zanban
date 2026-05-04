import { generateOneShot } from './baseLlm.js'

export type Intent = 'question' | 'command' | 'smalltalk' | 'none'

const SYSTEM = `Classify the user message into ONE of these labels (output ONLY the label, lowercase, no extra text):
- question — a substantive ask that expects an informational answer
- command — an imperative request that is essentially a question in disguise ("explain X", "summarize Y")
- smalltalk — greetings, acknowledgements, fillers
- none — empty / nonsense / pure noise

Default to "none" when uncertain.`

export async function classifyIntent(input: string): Promise<Intent> {
  if (!input.trim()) return 'none'
  try {
    const out = await generateOneShot({
      role: 'filter',
      system: SYSTEM,
      prompt: input,
      temperature: 0,
      maxOutputTokens: 8
    })
    const v = out.toLowerCase().trim()
    if (v === 'question' || v === 'command' || v === 'smalltalk' || v === 'none') return v
    return 'none'
  } catch {
    return 'none'
  }
}
