// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { TranscriptSegment } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { RollingTranscript } from './RollingTranscript'

function fSeg(
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment {
  return {
    id,
    text,
    channel,
    speaker: 0,
    startMs: 0,
    endMs: 0,
    isFinal: true,
    createdAt: Date.now()
  }
}

function pSeg(id: string, text: string, channel: TranscriptSegment['channel']): TranscriptSegment {
  return {
    id,
    text,
    channel,
    speaker: 0,
    startMs: 0,
    endMs: 0,
    isFinal: false,
    createdAt: Date.now()
  }
}

beforeEach(() => {
  useTranscript.setState({
    finals: [],
    partials: { mic: null, system: null },
    session: { kind: 'idle' },
    status: { mic: null, system: null },
    lastUpdateAt: null,
    lastFinalAt: null
  })
})

afterEach(() => {
  cleanup()
})

function makeRunning(): void {
  useTranscript.setState({ session: { kind: 'running', sessionId: 's1', startedAt: 0 } })
}

describe('RollingTranscript', () => {
  it('renders nothing when session is idle', () => {
    const { queryByTestId } = render(<RollingTranscript />)
    expect(queryByTestId('overlay-rolling-transcript')).toBeNull()
  })

  it('renders the pill when session is running', () => {
    makeRunning()
    const { getByTestId } = render(<RollingTranscript />)
    expect(getByTestId('overlay-rolling-transcript')).toBeTruthy()
  })

  it('renders BOTH mic and system finals (E1: two-channel)', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('m1', 'mic-line', 'mic'), fSeg('s1', 'system-line', 'system')]
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('system-line')
    expect(el.textContent).toContain('mic-line')
  })

  it('appends the live (interim) partial with a cursor', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('s1', 'final-text', 'system')],
      partials: { mic: pSeg('p1', 'draft-text', 'mic'), system: null }
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('final-text')
    expect(el.textContent).toContain('draft-text')
    expect(el.textContent).toContain('▍')
  })

  it('renders per-channel capture-health dots', () => {
    makeRunning()
    useTranscript.setState({
      status: {
        mic: { kind: 'open', channel: 'mic' },
        system: { kind: 'error', channel: 'system', message: 'boom' }
      }
    })
    const { container } = render(<RollingTranscript />)
    const micDot = container.querySelector('[data-channel="mic"]')
    const sysDot = container.querySelector('[data-channel="system"]')
    expect(micDot).toBeTruthy()
    expect(sysDot?.getAttribute('data-state')).toBe('error')
  })

  it('marks a channel as speaking right after a final lands', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('s1', 'hello', 'system')],
      status: { mic: null, system: { kind: 'open', channel: 'system' } }
    })
    const { container } = render(<RollingTranscript />)
    const sysDot = container.querySelector('[data-channel="system"]')
    expect(sysDot?.getAttribute('data-state')).toBe('speaking')
  })
})
