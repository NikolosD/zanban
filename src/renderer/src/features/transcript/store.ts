import { create } from 'zustand'
import type {
  AudioChannel,
  SessionState,
  TranscriptSegment,
  TranscriptionStatus
} from '@shared/types'
import { useQuestions, maybeExtractQuestion } from './questionsStore'
import { useAi } from '@renderer/features/ai/store'

interface TranscriptState {
  finals: TranscriptSegment[]
  partials: Record<AudioChannel, TranscriptSegment | null>
  session: SessionState
  status: Record<AudioChannel, TranscriptionStatus | null>
  /** Wall-clock time of the most recent segment update (partial OR final). */
  lastUpdateAt: number | null
  /** Wall-clock time of the most recent FINAL segment. */
  lastFinalAt: number | null
  pushSegment(seg: TranscriptSegment): void
  setSession(state: SessionState): void
  setStatus(status: TranscriptionStatus): void
  reset(): void
}

const MAX_FINALS = 500

export const useTranscript = create<TranscriptState>((set) => ({
  finals: [],
  partials: { mic: null, system: null },
  session: { kind: 'idle' },
  status: { mic: null, system: null },
  lastUpdateAt: null,
  lastFinalAt: null,
  pushSegment(seg) {
    set((s) => {
      if (seg.isFinal) {
        const finals = [...s.finals, seg]
        if (finals.length > MAX_FINALS) finals.splice(0, finals.length - MAX_FINALS)
        return {
          finals,
          partials: { ...s.partials, [seg.channel]: null },
          lastUpdateAt: Date.now(),
          lastFinalAt: Date.now()
        }
      }
      return {
        partials: { ...s.partials, [seg.channel]: seg },
        lastUpdateAt: Date.now()
      }
    })
    const candidate = maybeExtractQuestion(seg)
    if (candidate) {
      console.debug('[q] -> LLM', candidate.text.slice(0, 80))
      void window.zanban.ai
        .extractQuestion(candidate.text)
        .then((cleaned) => {
          if (!cleaned) {
            console.debug('[q] LLM returned NONE for:', candidate.text.slice(0, 80))
            return
          }
          console.debug('[q] LLM kept:', cleaned.slice(0, 80))
          useQuestions.getState().push({ ...candidate, text: cleaned })
        })
        .catch((err) => console.warn('[q] LLM error', err))
    }

    // Auto-dismiss pending questions when YOU starts answering. We treat any
    // non-trivial mic-channel final (>=15 chars) within 60s of a pending
    // question as the user beginning to answer it.
    if (seg.isFinal && seg.channel === 'mic' && seg.text.trim().length >= 15) {
      const qs = useQuestions.getState().questions
      const cutoff = seg.createdAt - 60_000
      const target = [...qs]
        .reverse()
        .find((q) => q.status === 'pending' && q.detectedAt >= cutoff)
      if (target) useQuestions.getState().markAnswered(target.id)
    }
  },
  setSession(state) {
    set((prev) => {
      // When a fresh session starts (new sessionId, or coming out of idle),
      // wipe the live transcript / Q&A / detected questions so the UI doesn't
      // show stale content from the previous call.
      const prevId = prev.session.kind === 'running' ? prev.session.sessionId : null
      const nextId = state.kind === 'running' ? state.sessionId : null
      if (nextId && nextId !== prevId) {
        useQuestions.getState().reset()
        useAi.getState().reset()
        return {
          session: state,
          finals: [],
          partials: { mic: null, system: null },
          lastUpdateAt: null,
          lastFinalAt: null
        }
      }
      return { session: state }
    })
  },
  setStatus(status) {
    if (status.kind === 'idle') {
      set({ status: { mic: null, system: null } })
      return
    }
    set((s) => ({ status: { ...s.status, [status.channel]: status } }))
  },
  reset() {
    set({
      finals: [],
      partials: { mic: null, system: null },
      session: { kind: 'idle' },
      lastUpdateAt: null,
      lastFinalAt: null
    })
  }
}))

export function wireTranscriptIpc(): () => void {
  const offSeg = window.zanban.transcription.onSegment((seg) =>
    useTranscript.getState().pushSegment(seg)
  )
  const offSt = window.zanban.transcription.onStatus((st) =>
    useTranscript.getState().setStatus(st)
  )
  const offSession = window.zanban.session.onState((s) => useTranscript.getState().setSession(s))
  return () => {
    offSeg()
    offSt()
    offSession()
  }
}
