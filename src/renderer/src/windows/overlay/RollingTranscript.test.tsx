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
  return { id, text, channel, speaker: 0, startMs: 0, endMs: 0, isFinal: true, createdAt: 0 }
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

  it('renders only system-channel finals', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('m1', 'mic-line', 'mic'), fSeg('s1', 'system-line', 'system')]
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('system-line')
    expect(el.textContent).not.toContain('mic-line')
  })

  it('does not render the live (interim) partial — only finalized text', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('s1', 'final-text', 'system')],
      partials: {
        mic: null,
        system: {
          id: 'p1',
          text: 'draft-text',
          channel: 'system',
          speaker: 0,
          startMs: 0,
          endMs: 0,
          isFinal: false,
          createdAt: 0
        }
      }
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('final-text')
    expect(el.textContent).not.toContain('draft-text')
    expect(el.textContent).not.toContain('▍')
  })
})
