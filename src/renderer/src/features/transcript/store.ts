import { create } from 'zustand'
import type {
  AudioChannel,
  SessionState,
  TranscriptSegment,
  TranscriptionStatus
} from '@shared/types'
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
  },
  setSession(state) {
    set((prev) => {
      // When a fresh session starts (new sessionId, or coming out of idle),
      // wipe the live transcript and Q&A (useAi) so the UI doesn't show
      // stale content from the previous call.
      const prevId = prev.session.kind === 'running' ? prev.session.sessionId : null
      const nextId = state.kind === 'running' ? state.sessionId : null
      if (nextId && nextId !== prevId) {
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
  const offSt = window.zanban.transcription.onStatus((st) => useTranscript.getState().setStatus(st))
  const offSession = window.zanban.session.onState((s) => useTranscript.getState().setSession(s))
  return () => {
    offSeg()
    offSt()
    offSession()
  }
}
