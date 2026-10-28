import type { ILlmProvider, LlmFinishReason, LlmStreamArgs } from '../types.js'
import { normalizeFinishReason } from './finishReason.js'

const DEFAULT_HOST = 'http://127.0.0.1:11434'

/**
 * Ollama LLM provider — talks to a locally-running `ollama serve` over HTTP.
 * No SDK; the streaming API is just NDJSON, which is simpler to parse than
 * any vendor SDK.
 */
export function makeOllamaProvider(host: string = DEFAULT_HOST): ILlmProvider {
  return {
    id: 'ollama',
    label: 'Ollama (local)',
    async *stream(args: LlmStreamArgs): AsyncGenerator<string, LlmFinishReason | undefined, void> {
      // Ollama's chat API accepts a per-message `images` array of base64
      // strings (no data-url prefix). Vision-capable models like `qwen3.5` and
      // `llava` consume this; text-only models silently ignore it.
      const userMsg: Record<string, unknown> = { role: 'user', content: args.prompt }
      if (args.imageDataUrl) {
        const m = args.imageDataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/)
        if (m) userMsg.images = [m[1]]
      }
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: args.model,
          messages: [{ role: 'system', content: args.system }, userMsg],
          options: {
            temperature: args.temperature ?? 0.3,
            num_predict: args.maxOutputTokens ?? 1200
          },
          // Qwen3 models think before answering unless told not to. Only sent to
          // them: other models may reject `think` when they can't think.
          ...(args.model.startsWith('qwen3') ? { think: false } : {}),
          stream: true
        }),
        signal: args.signal
      })
      if (!res.ok || !res.body) {
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      // Ollama puts `done_reason` ('stop' | 'length' | 'load') on the terminal
      // NDJSON object alongside `done: true`.
      let doneReason: string | undefined
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let obj: {
            message?: { content?: string }
            done?: boolean
            done_reason?: string
            error?: string
          }
          try {
            obj = JSON.parse(line) as typeof obj
          } catch {
            continue // tolerate partial chunks
          }
          if (obj.error) throw new Error(`Ollama error: ${obj.error}`)
          if (obj.done_reason) doneReason = obj.done_reason
          if (obj.message?.content) yield obj.message.content
        }
      }
      return normalizeFinishReason(doneReason)
    },
    async generate(args) {
      let out = ''
      for await (const chunk of this.stream(args)) out += chunk
      return out.trim()
    }
  }
}
