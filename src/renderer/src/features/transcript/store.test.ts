import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState, TranscriptSegment, TranscriptionStatus } from '@shared/types'
import { useAi } from '@renderer/features/ai/store'
import { useTranscript, wireTranscriptIpc } from './store'

function seg(text: string, over: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: text,
    channel: 'mic',
    speaker: 0,
    startMs: 0,
    endMs: 0,
    text,
    isFinal: true,
    createdAt: 0,
    ...over
  }
}

function running(sessionId: string): SessionState {
  return { kind: 'running', sessionId, startedAt: 1 }
}

beforeEach(() => {
  useTranscript.getState().reset()
  useTranscript.setState({ status: { mic: null, system: null } })
  useAi.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('live transcript', () => {
  it('keeps the latest 500 finals and drops the oldest', () => {
    for (let i = 0; i < 520; i++) useTranscript.getState().pushSegment(seg(`line ${i}`))

    const { finals } = useTranscript.getState()
    expect(finals).toHaveLength(500)
    expect(finals[0]?.text).toBe('line 20')
    expect(finals.at(-1)?.text).toBe('line 519')
  })

  it('shows one interim per channel and clears only that channel when its sentence is final', () => {
    const t = useTranscript.getState()
    t.pushSegment(seg('so what did', { isFinal: false }))
    t.pushSegment(seg('so what did you', { isFinal: false }))
    t.pushSegment(seg('they said', { isFinal: false, channel: 'system' }))
    expect(useTranscript.getState().partials.mic?.text).toBe('so what did you')
    expect(useTranscript.getState().partials.system?.text).toBe('they said')

    t.pushSegment(seg('So what did you build?'))

    const { partials, finals } = useTranscript.getState()
    expect(partials.mic).toBeNull()
    expect(partials.system?.text).toBe('they said')
    expect(finals.map((f) => f.text)).toEqual(['So what did you build?'])
  })

  it('stamps the last update on every segment but the last final only on finals', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const t = useTranscript.getState()

    t.pushSegment(seg('hello', { isFinal: false }))
    expect(useTranscript.getState()).toMatchObject({ lastUpdateAt: 1_000, lastFinalAt: null })

    vi.setSystemTime(2_000)
    t.pushSegment(seg('Hello.'))
    expect(useTranscript.getState()).toMatchObject({ lastUpdateAt: 2_000, lastFinalAt: 2_000 })

    vi.setSystemTime(3_000)
    t.pushSegment(seg('and', { isFinal: false }))
    expect(useTranscript.getState()).toMatchObject({ lastUpdateAt: 3_000, lastFinalAt: 2_000 })
  })
})

describe('session changes', () => {
  it('wipes the previous call’s transcript, interims and Q&A when a new call starts', () => {
    const t = useTranscript.getState()
    t.setSession(running('call-1'))
    t.pushSegment(seg('old line'))
    t.pushSegment(seg('old interim', { isFinal: false, channel: 'system' }))
    useAi.getState().newRequest('Who are you?', 'req-1')

    t.setSession({ kind: 'idle' })
    t.setSession(running('call-2'))

    const state = useTranscript.getState()
    expect(state.finals).toEqual([])
    expect(state.partials).toEqual({ mic: null, system: null })
    expect(state.lastUpdateAt).toBeNull()
    expect(state.lastFinalAt).toBeNull()
    expect(useAi.getState().messages).toEqual([])
  })

  it('wipes it when a different call replaces one that was still running', () => {
    const t = useTranscript.getState()
    t.setSession(running('call-1'))
    t.pushSegment(seg('old line'))

    t.setSession(running('call-2'))

    expect(useTranscript.getState().finals).toEqual([])
  })

  it('keeps everything when the same running call is announced again', () => {
    const t = useTranscript.getState()
    t.setSession(running('call-1'))
    t.pushSegment(seg('kept line'))
    useAi.getState().newRequest('Question', 'req-1')

    t.setSession(running('call-1'))

    expect(useTranscript.getState().finals.map((f) => f.text)).toEqual(['kept line'])
    expect(useAi.getState().messages).toHaveLength(1)
  })

  it('keeps the finished call on screen while it stops and after it is idle', () => {
    const t = useTranscript.getState()
    t.setSession(running('call-1'))
    t.pushSegment(seg('last line'))

    t.setSession({ kind: 'stopping' })
    t.setSession({ kind: 'idle' })

    expect(useTranscript.getState().finals.map((f) => f.text)).toEqual(['last line'])
    expect(useTranscript.getState().session).toEqual({ kind: 'idle' })
  })

  it('starts the first call from a clean slate', () => {
    const t = useTranscript.getState()
    t.pushSegment(seg('late straggler'))

    t.setSession(running('call-1'))

    expect(useTranscript.getState().finals).toEqual([])
  })
})

describe('channel status', () => {
  it('tracks each channel separately and clears both on idle', () => {
    const t = useTranscript.getState()
    const micError: TranscriptionStatus = {
      kind: 'error',
      channel: 'mic',
      message: 'socket hang up'
    }

    t.setStatus(micError)
    t.setStatus({ kind: 'open', channel: 'system' })
    expect(useTranscript.getState().status).toEqual({
      mic: micError,
      system: { kind: 'open', channel: 'system' }
    })

    t.setStatus({ kind: 'idle' })
    expect(useTranscript.getState().status).toEqual({ mic: null, system: null })
  })
})

describe('wireTranscriptIpc', () => {
  it('feeds segments, status and session changes into the store, and detaches all three', () => {
    const handlers: Record<string, (payload: never) => void> = {}
    const offs = { segment: vi.fn(), status: vi.fn(), state: vi.fn() }
    vi.stubGlobal('window', {
      zanban: {
        transcription: {
          onSegment: (cb: (s: TranscriptSegment) => void) => {
            handlers.segment = cb as never
            return offs.segment
          },
          onStatus: (cb: (s: TranscriptionStatus) => void) => {
            handlers.status = cb as never
            return offs.status
          }
        },
        session: {
          onState: (cb: (s: SessionState) => void) => {
            handlers.state = cb as never
            return offs.state
          }
        }
      }
    })

    const unwire = wireTranscriptIpc()
    handlers.state!(running('call-1') as never)
    handlers.segment!(seg('Привет!') as never)
    handlers.status!({ kind: 'open', channel: 'mic' } as never)

    expect(useTranscript.getState().finals.map((f) => f.text)).toEqual(['Привет!'])
    expect(useTranscript.getState().status.mic).toEqual({ kind: 'open', channel: 'mic' })

    unwire()
    expect(offs.segment).toHaveBeenCalledTimes(1)
    expect(offs.status).toHaveBeenCalledTimes(1)
    expect(offs.state).toHaveBeenCalledTimes(1)
  })
})
