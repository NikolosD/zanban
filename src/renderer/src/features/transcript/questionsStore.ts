import { create } from 'zustand'
import type { TranscriptSegment } from '@shared/types'

export interface DetectedQuestion {
  id: string
  text: string
  detectedAt: number
  status: 'pending' | 'answered' | 'dismissed'
}

interface QuestionsState {
  questions: DetectedQuestion[]
  push(q: DetectedQuestion): void
  markAnswered(id: string): void
  dismiss(id: string): void
  reset(): void
}

export const useQuestions = create<QuestionsState>((set) => ({
  questions: [],
  push(q) {
    set((s) => {
      const recent = s.questions.filter(
        (e) => e.status === 'pending' && q.detectedAt - e.detectedAt < 8000
      )
      const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')
      const a = norm(q.text)
      for (const e of recent) {
        const b = norm(e.text)
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          console.debug('[q] dedup drop:', q.text.slice(0, 60))
          return s
        }
      }
      console.debug('[q] PUSHED — chip should appear:', q.text.slice(0, 80))
      return { questions: [...s.questions.slice(-9), q] }
    })
  },
  markAnswered(id) {
    set((s) => ({
      questions: s.questions.map((q) => (q.id === id ? { ...q, status: 'answered' } : q))
    }))
  },
  dismiss(id) {
    set((s) => ({
      questions: s.questions.map((q) => (q.id === id ? { ...q, status: 'dismissed' } : q))
    }))
  },
  reset() {
    set({ questions: [] })
  }
}))

// Heuristic shortcut: if the text contains an interrogative marker we already
// know it's worth running through the LLM extractor (faster, no API roundtrip
// when obvious). When neither hits, we STILL send to the LLM — modern Whisper
// often drops the trailing "?", and questions are routinely embedded inside
// longer multi-sentence utterances ("А давай перейдём… А расскажи, какие
// в целом есть уязвимости с чем ты сталкивался сам."). A regex that demands
// the cue be at the start of the string would silently swallow most of those.
//
// Cost guard: the LLM extractor (gpt-oss-20b @ $0.07 in / $0.30 out per 1M
// tokens, ~20-token prompt, 0.1s TTFT) is dirt cheap — running it on every
// final system-channel segment over a 1-hour call costs <$0.01.
const QUESTION_HINT =
  /[?？]|\b(расскажи|объясни|опиши|поделись|поясни|подскажи|скажи|почему|зачем|когда|какой|какая|какое|какие|сколько|tell me|explain|describe|walk me|how do|how would|how does|how can|how should|what is|what are|what was|what's|why|when|where|which|who|whose|can you|could you)\b/i

export function maybeExtractQuestion(seg: TranscriptSegment): DetectedQuestion | null {
  if (!seg.isFinal) {
    return null
  }
  if (seg.channel !== 'system') {
    console.debug('[q] skip: not system channel', { channel: seg.channel, text: seg.text.slice(0, 60) })
    return null
  }
  const text = seg.text.trim()
  if (text.length < 12) {
    console.debug('[q] skip: too short', { len: text.length, text })
    return null
  }
  if (text.length < 40 && !QUESTION_HINT.test(text)) {
    console.debug('[q] skip: short and no cue', { len: text.length, text })
    return null
  }
  console.debug('[q] candidate', { len: text.length, text: text.slice(0, 80) })
  return {
    id: seg.id,
    text,
    detectedAt: seg.createdAt,
    status: 'pending'
  }
}
