import { generateOneShot } from './baseLlm.js'

const SYSTEM = `You are a clarifying-question generator for a real-time meeting assistant.
Given an ambiguous request from the user, produce ONE short clarifying question that — once answered — will let an AI assistant respond well.
Rules:
- Output ONLY the question, no preamble.
- Keep it under 18 words.
- Match the language of the user input.
- If the input is already specific enough, output the literal token "OK" with no other text.`

/**
 * Generate ONE clarifying question for an ambiguous user prompt, or "OK" if
 * the prompt is already actionable.
 */
export async function clarify(userPrompt: string): Promise<string | null> {
  const out = await generateOneShot({
    role: 'filter',
    system: SYSTEM,
    prompt: userPrompt,
    temperature: 0.3,
    maxOutputTokens: 60
  })
  if (!out || out === 'OK') return null
  return out
}
