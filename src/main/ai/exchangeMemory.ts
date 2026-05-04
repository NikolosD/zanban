// Tracks the last few Q&A exchanges so each new ask can include them as context.
// This makes Gemini avoid repeating earlier answers and helps it stay coherent
// across a conversation flow.

const MAX_EXCHANGES = 5
const MAX_ANSWER_CHARS = 600

export interface Exchange {
  prompt: string
  answer: string
  finishedAt: number
}

const exchanges: Exchange[] = []

export function recordExchange(prompt: string, answer: string): void {
  if (!answer.trim()) return
  const trimmed = answer.length > MAX_ANSWER_CHARS ? answer.slice(0, MAX_ANSWER_CHARS) + '…' : answer
  exchanges.push({ prompt: prompt.trim(), answer: trimmed.trim(), finishedAt: Date.now() })
  if (exchanges.length > MAX_EXCHANGES) {
    exchanges.splice(0, exchanges.length - MAX_EXCHANGES)
  }
}

export function getExchanges(): Exchange[] {
  return [...exchanges]
}

export function clearExchanges(): void {
  exchanges.length = 0
}

export function exchangeCount(): number {
  return exchanges.length
}
