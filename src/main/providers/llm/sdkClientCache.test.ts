import { describe, it, expect, vi } from 'vitest'

const constructed = vi.hoisted(() => ({
  anthropic: [] as string[],
  openai: [] as string[],
  groq: [] as string[]
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }
    constructor(opts: { apiKey: string }) {
      constructed.anthropic.push(opts.apiKey)
    }
  }
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    constructor(opts: { apiKey: string }) {
      constructed.openai.push(opts.apiKey)
    }
  }
}))
vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    constructor(opts: { apiKey: string }) {
      constructed.groq.push(opts.apiKey)
    }
  }
}))

const { makeAnthropicProvider } = await import('./anthropic.js')
const { makeOpenAiProvider } = await import('./openai.js')
const { makeGroqProvider } = await import('./groq.js')

const args = { model: 'm', system: 's', prompt: 'p' }

describe('LLM SDK client cache', () => {
  it.each([
    ['anthropic', makeAnthropicProvider],
    ['openai', makeOpenAiProvider],
    ['groq', makeGroqProvider]
  ] as const)('%s builds one SDK client per API key', async (id, make) => {
    expect(await make('key-a').generate(args)).toBe('ok')
    await make('key-a').generate(args)
    await make('key-b').generate(args)
    expect(constructed[id]).toEqual(['key-a', 'key-b'])
  })
})
