import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent = vi.hoisted(() => ({ body: undefined as Record<string, unknown> | undefined }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        sent.body = body
        return { content: [{ type: 'text', text: 'ok' }] }
      }
    }
  }
}))
const chatCompletions = {
  create: async (body: Record<string, unknown>) => {
    sent.body = body
    return { choices: [{ message: { content: 'ok' } }] }
  }
}
vi.mock('openai', () => ({
  default: class {
    chat = { completions: chatCompletions }
  }
}))
vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: chatCompletions }
  }
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (body: Record<string, unknown>) => {
        sent.body = body
        return { text: 'ok' }
      }
    }
  }
}))

const { makeAnthropicProvider } = await import('./anthropic.js')
const { makeOpenAiProvider } = await import('./openai.js')
const { makeGroqProvider } = await import('./groq.js')
const { makeGeminiProvider } = await import('./gemini.js')

const args = { system: 's', prompt: 'p', temperature: 0.3 }

beforeEach(() => {
  sent.body = undefined
})

describe('LLM request params', () => {
  it('Anthropic never sends temperature and turns 5.5 thinking off', async () => {
    const p = makeAnthropicProvider('k')
    await p.generate({ ...args, model: 'claude-haiku-5-5' })
    expect(sent.body).not.toHaveProperty('temperature')
    expect(sent.body?.thinking).toEqual({ type: 'disabled' })
    await p.generate({ ...args, model: 'claude-sonnet-5-5' })
    expect(sent.body?.thinking).toEqual({ type: 'between_tools' })
    await p.generate({ ...args, model: 'claude-haiku-4-5' })
    expect(sent.body?.thinking).toBeUndefined()
  })

  it('OpenAI uses max_completion_tokens with reasoning off and no temperature', async () => {
    await makeOpenAiProvider('k').generate({ ...args, model: 'gpt-6-luna', maxOutputTokens: 50 })
    expect(sent.body).toMatchObject({ max_completion_tokens: 50, reasoning_effort: 'none' })
    expect(sent.body).not.toHaveProperty('max_tokens')
    expect(sent.body).not.toHaveProperty('temperature')
  })

  it('Groq lowers gpt-oss reasoning and turns Qwen reasoning off', async () => {
    const p = makeGroqProvider('k')
    await p.generate({ ...args, model: 'openai/gpt-oss-20b' })
    expect(sent.body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 800 })
    await p.generate({ ...args, model: 'qwen/qwen3.8-27b' })
    expect(sent.body?.reasoning_effort).toBe('none')
  })

  it('Gemini leaves temperature at the model default', async () => {
    await makeGeminiProvider('k').generate({ ...args, model: 'gemini-3.5-flash-lite' })
    expect(sent.body?.config).not.toHaveProperty('temperature')
  })
})
