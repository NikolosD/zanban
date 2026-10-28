import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CaptureNotice, TranscriptSegment } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import {
  applyNotice,
  visibleNotice,
  wireCaptureNotices,
  useCaptureNotices,
  NO_NOTICES,
  HEALED_VISIBLE_MS
} from './captureNotices'

function micPartial(text: string): TranscriptSegment {
  return {
    id: 'p1',
    text,
    channel: 'mic',
    speaker: 0,
    startMs: 0,
    endMs: 0,
    isFinal: false,
    createdAt: 0
  }
}

describe('applyNotice + visibleNotice', () => {
  it('shows nothing without notices', () => {
    expect(visibleNotice(NO_NOTICES)).toBeNull()
  })

  it('a lost mic outranks the standing system warning', () => {
    const flags = applyNotice(applyNotice(NO_NOTICES, 'system-unavailable'), 'mic-lost')
    expect(visibleNotice(flags)).toBe('mic-lost')
  })

  it('healing replaces the lost state and the system warning resumes after it', () => {
    let flags = applyNotice(applyNotice(NO_NOTICES, 'system-unavailable'), 'mic-lost')
    flags = applyNotice(flags, 'mic-healed')
    expect(visibleNotice(flags)).toBe('mic-healed')
    expect(visibleNotice({ ...flags, micHealed: false })).toBe('system-unavailable')
  })

  it('a silent-mic hint shows only when nothing more urgent is up', () => {
    expect(visibleNotice(applyNotice(NO_NOTICES, 'mic-silent'))).toBe('mic-silent')
    const lost = applyNotice(applyNotice(NO_NOTICES, 'mic-silent'), 'mic-lost')
    expect(visibleNotice(lost)).toBe('mic-lost')
    expect(lost.micSilent).toBe(false)
  })
})

describe('wireCaptureNotices', () => {
  let emit: (n: CaptureNotice) => void = () => {}
  let off: () => void = () => {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      zanban: {
        audio: {
          onNotice: (cb: (n: CaptureNotice) => void) => {
            emit = cb
            return () => {}
          }
        }
      }
    })
    useCaptureNotices.setState({ flags: NO_NOTICES })
    useTranscript.setState({
      finals: [],
      partials: { mic: null, system: null },
      session: { kind: 'running', sessionId: 's1', startedAt: 0 }
    })
    off = wireCaptureNotices()
  })

  afterEach(() => {
    off()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const shown = (): string | null => visibleNotice(useCaptureNotices.getState().flags)

  it('hides the mic-back confirmation after a few seconds', () => {
    emit({ kind: 'mic-lost' })
    emit({ kind: 'mic-healed' })
    expect(shown()).toBe('mic-healed')
    vi.advanceTimersByTime(HEALED_VISIBLE_MS)
    expect(shown()).toBeNull()
  })

  it('clears the silent-mic hint once mic speech is transcribed', () => {
    emit({ kind: 'mic-silent' })
    expect(shown()).toBe('mic-silent')
    useTranscript.setState({ partials: { mic: micPartial('hello'), system: null } })
    expect(shown()).toBeNull()
  })

  it('drops every notice when the session ends', () => {
    emit({ kind: 'system-unavailable' })
    expect(shown()).toBe('system-unavailable')
    useTranscript.setState({ session: { kind: 'idle' } })
    expect(shown()).toBeNull()
  })
})
