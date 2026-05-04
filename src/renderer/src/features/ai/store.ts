import { create } from 'zustand'

interface AiMessage {
  id: string
  prompt: string
  answer: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  finishReason?: string
}

interface AiState {
  messages: AiMessage[]
  pending: Record<string, string>
  newRequest(prompt: string, requestId: string): void
  appendChunk(requestId: string, text: string): void
  finishRequest(requestId: string, finishReason?: string): void
  failRequest(requestId: string, message: string): void
  reset(): void
}

export const useAi = create<AiState>((set) => ({
  messages: [],
  pending: {},
  newRequest(prompt, requestId) {
    set((s) => ({
      messages: [
        ...s.messages,
        { id: requestId, prompt, answer: '', status: 'streaming' }
      ]
    }))
  },
  appendChunk(requestId, text) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, answer: m.answer + text } : m
      )
    }))
  },
  finishRequest(requestId, finishReason) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, status: 'done', finishReason } : m
      )
    }))
  },
  failRequest(requestId, message) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === requestId ? { ...m, status: 'error', error: message } : m
      )
    }))
  },
  reset() {
    set({ messages: [], pending: {} })
  }
}))

export function wireAiIpc(): () => void {
  const offChunk = window.zanban.ai.onChunk(({ requestId, text }) =>
    useAi.getState().appendChunk(requestId, text)
  )
  const offDone = window.zanban.ai.onDone(({ requestId, finishReason }) =>
    useAi.getState().finishRequest(requestId, finishReason)
  )
  const offErr = window.zanban.ai.onError(({ requestId, message }) =>
    useAi.getState().failRequest(requestId, message)
  )
  return () => {
    offChunk()
    offDone()
    offErr()
  }
}
