import { describe, it, expect } from 'vitest'
import { deriveChannelState, MIC_PEAK_THRESHOLD, SPEAKING_WINDOW_MS } from './captureHealth'

const NOW = 1_000_000

describe('deriveChannelState', () => {
  it('reports idle when nothing has started', () => {
    expect(deriveChannelState('system', { status: null, lastActivityAt: null, now: NOW })).toBe(
      'idle'
    )
  })

  it('reports error when the STT status errored, even with recent text', () => {
    expect(
      deriveChannelState('system', {
        status: { kind: 'error', channel: 'system', message: 'boom' },
        lastActivityAt: NOW,
        now: NOW
      })
    ).toBe('error')
  })

  it('reports connecting while the socket is opening', () => {
    expect(
      deriveChannelState('mic', {
        status: { kind: 'connecting', channel: 'mic' },
        lastActivityAt: null,
        now: NOW
      })
    ).toBe('connecting')
  })

  it('reports speaking when there was recent recognized text', () => {
    expect(
      deriveChannelState('system', {
        status: { kind: 'open', channel: 'system' },
        lastActivityAt: NOW - 200,
        now: NOW
      })
    ).toBe('speaking')
  })

  it('falls back to idle once the speaking window elapses', () => {
    expect(
      deriveChannelState('system', {
        status: { kind: 'open', channel: 'system' },
        lastActivityAt: NOW - SPEAKING_WINDOW_MS - 1,
        now: NOW
      })
    ).toBe('idle')
  })

  it('reports speaking for a loud mic peak before any text arrives', () => {
    expect(
      deriveChannelState('mic', {
        status: { kind: 'open', channel: 'mic' },
        lastActivityAt: null,
        micPeak: MIC_PEAK_THRESHOLD + 0.01,
        now: NOW
      })
    ).toBe('speaking')
  })

  it('ignores mic peak for the system channel', () => {
    expect(
      deriveChannelState('system', {
        status: { kind: 'open', channel: 'system' },
        lastActivityAt: null,
        micPeak: 1,
        now: NOW
      })
    ).toBe('idle')
  })
})
