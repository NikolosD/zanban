import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent = vi.hoisted(() => ({ body: undefined as Record<string, unknown> | undefined }))

async function* listed<T>(...items: T[]): AsyncGenerator<T> {
  yield* items
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    models = { list: () => listed({ id: 'claude-haiku-5-5' }) }
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
    models = { list: () => listed({ id: 'gpt-6.1-terra' }) }
    chat = { completions: chatCompletions }
  }
}))
vi.mock('groq-sdk', () => ({
  default: class {
    models = { list: async () => ({ data: [{ id: 'openai/gpt-oss-120b' }] }) }
    chat = { completions: chatCompletions }
  }
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      list: async () => listed({ name: 'models/gemini-3.5-flash-lite' }, {}),
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

describe('LLM request order', () => {
  const ordered = { ...args, system: 'SYSTEM', prompt: 'VOLATILE' }

  it.each([
    ['OpenAI', makeOpenAiProvider, 'gpt-6.1-terra'],
    ['Groq', makeGroqProvider, 'openai/gpt-oss-120b']
  ] as const)(
    '%s gets the unchanging system prompt first and the volatile one last',
    async (_, make, model) => {
      await make('k').generate({ ...ordered, model })
      expect(sent.body?.messages).toEqual([
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'VOLATILE' }
      ])
    }
  )

  it('Gemini gets the system prompt as its instruction, apart from the volatile contents', async () => {
    await makeGeminiProvider('k').generate({ ...ordered, model: 'gemini-3.5-flash-lite' })
    expect(sent.body?.config).toMatchObject({ systemInstruction: 'SYSTEM' })
    expect(sent.body?.contents).toEqual([{ role: 'user', parts: [{ text: 'VOLATILE' }] }])
  })
})

describe('LLM model lists', () => {
  it('lists the ids each provider takes in a request', async () => {
    const signal = new AbortController().signal
    expect(await makeAnthropicProvider('k').listModels?.(signal)).toEqual(['claude-haiku-5-5'])
    expect(await makeOpenAiProvider('k').listModels?.(signal)).toEqual(['gpt-6.1-terra'])
    expect(await makeGroqProvider('k').listModels?.(signal)).toEqual(['openai/gpt-oss-120b'])
    expect(await makeGeminiProvider('k').listModels?.(signal)).toEqual(['gemini-3.5-flash-lite'])
  })
})
