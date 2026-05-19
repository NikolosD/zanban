// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { TranscriptSegment, AppSettings } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { useQuestions } from '@renderer/features/transcript/questionsStore'
import { useSettingsStore } from '@renderer/features/settings/store'
import { RollingTranscript } from './RollingTranscript'

function fSeg(
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment {
  return { id, text, channel, isFinal: true, createdAt: 0 }
}

function settingsWith(autoDetectQuestions: boolean): AppSettings {
  return { autoDetectQuestions } as unknown as AppSettings
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
  useQuestions.setState({ questions: [] })
  useSettingsStore.setState({ settings: null })
})

afterEach(() => {
  cleanup()
})

function makeRunning(): void {
  useTranscript.setState({
    session: { kind: 'running', sessionId: 's1', startedAt: 0 }
  })
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

  it('highlights a segment whose id matches a pending question', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'tell me about react?', 'system')] })
    useQuestions.setState({
      questions: [{ id: 's1', text: 'tell me about react?', detectedAt: 0, status: 'pending' }]
    })
    useSettingsStore.setState({ settings: settingsWith(true) })
    const { container } = render(<RollingTranscript />)
    const highlighted = container.querySelector('[data-highlight="pending"]')
    expect(highlighted?.textContent).toBe('tell me about react?')
  })

  it('dims the highlight after the question is marked answered', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'q?', 'system')] })
    useQuestions.setState({
      questions: [{ id: 's1', text: 'q?', detectedAt: 0, status: 'answered' }]
    })
    useSettingsStore.setState({ settings: settingsWith(true) })
    const { container } = render(<RollingTranscript />)
    expect(container.querySelector('[data-highlight="pending"]')).toBeNull()
    expect(container.querySelector('[data-highlight="resolved"]')?.textContent).toBe('q?')
  })

  it('does not highlight when autoDetectQuestions is false', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'q?', 'system')] })
    useQuestions.setState({
      questions: [{ id: 's1', text: 'q?', detectedAt: 0, status: 'pending' }]
    })
    useSettingsStore.setState({ settings: settingsWith(false) })
    const { container } = render(<RollingTranscript />)
    expect(container.querySelector('[data-highlight="pending"]')).toBeNull()
    expect(container.querySelector('[data-highlight="resolved"]')).toBeNull()
  })

  it('shows partial system text in the tail with the cursor glyph', () => {
    makeRunning()
    useTranscript.setState({
      partials: {
        mic: null,
        system: {
          id: 'p1',
          text: 'still talking',
          channel: 'system',
          isFinal: false,
          createdAt: 0
        }
      }
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('still talking')
    expect(el.textContent).toContain('▍')
  })
})
