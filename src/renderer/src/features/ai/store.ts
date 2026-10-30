import { create } from 'zustand'
import i18n from 'i18next'
import type { AiSource } from '@shared/types'

/** What produced an answer, so Regenerate can ask it again. */
export interface AskedRequest {
  prompt: string
  label?: string
  image: string | null
  ocr: string | null
}

interface AiMessage {
  id: string
  prompt: string
  answer: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  finishReason?: string
  /** RAG fragments retrieved for this answer (Sources affordance). */
  sources?: AiSource[]
  request?: AskedRequest
  /** What the other side said that this answer responds to, fixed when it was asked. */
  question?: string
}

interface AiState {
  messages: AiMessage[]
  pending: Record<string, string>
  newRequest(prompt: string, requestId: string, request?: AskedRequest, question?: string): void
  /** Stream `requestId` onto the end of the answer `fromId` and make it the latest. */
  resumeRequest(fromId: string, requestId: string): void
  appendChunk(requestId: string, text: string): void
  setSources(requestId: string, sources: AiSource[]): void
  finishRequest(requestId: string, finishReason?: string): void
  failRequest(requestId: string, message: string): void
  reset(): void
}

export const useAi = create<AiState>((set) => ({
  messages: [],
  pending: {},
  newRequest(prompt, requestId, request, question) {
    set((s) => ({
      messages: [
        ...s.messages,
        { id: requestId, prompt, answer: '', status: 'streaming', request, question }
      ]
    }))
  },
  resumeRequest(fromId, requestId) {
    set((s) => {
      const from = s.messages.find((m) => m.id === fromId)
      if (!from) return s
      return {
        messages: [
          ...s.messages.filter((m) => m !== from),
          { ...from, id: requestId, status: 'streaming', error: undefined, finishReason: undefined }
        ]
      }
    })
  },
  appendChunk(requestId, text) {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === requestId ? { ...m, answer: m.answer + text } : m))
    }))
  },
  setSources(requestId, sources) {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === requestId ? { ...m, sources } : m))
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
  const offSources = window.zanban.ai.onSources(({ requestId, sources }) =>
    useAi.getState().setSources(requestId, sources)
  )
  const offDone = window.zanban.ai.onDone(({ requestId, finishReason }) =>
    useAi.getState().finishRequest(requestId, finishReason)
  )
  const offErr = window.zanban.ai.onError(({ requestId, message, reason }) =>
    useAi
      .getState()
      .failRequest(requestId, reason ? i18n.t(`ai_errors.${reason.kind}`, reason) : message)
  )
  return () => {
    offChunk()
    offSources()
    offDone()
    offErr()
  }
}
