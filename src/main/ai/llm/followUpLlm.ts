import { generateOneShot } from './baseLlm.js'

const SYSTEM = `You generate 3 short follow-up questions a meeting participant might naturally ask after the AI's answer. Format strictly as a JSON array of 3 strings, e.g. ["…", "…", "…"]. No prose, no markdown fencing. Match the answer's language. Keep each question under 14 words.`

/**
 * Suggest 3 follow-up questions given the most recent Q+A turn.
 * Returns an empty array on parse failure or LLM error.
 */
export async function suggestFollowUps(question: string, answer: string): Promise<string[]> {
  try {
    const out = await generateOneShot({
      role: 'filter',
      system: SYSTEM,
      prompt: `Q: ${question}\nA: ${answer}`,
      temperature: 0.5,
      maxOutputTokens: 200
    })
    const parsed = JSON.parse(out) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, 3)
  } catch {
    return []
  }
}
