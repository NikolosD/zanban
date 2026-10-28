import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => ({
  startSystem: vi.fn(),
  onSilent: null as (() => void) | null,
  cancelWatch: vi.fn()
}))

vi.mock('./micCapture', () => ({
  startMic: async () => ({ stop: () => {} }),
  startSystem: audio.startSystem
}))
vi.mock('./level', () => ({
  watchMicSilence: (_ms: number, onSilent: () => void) => {
    audio.onSilent = onSilent
    return audio.cancelWatch
  }
}))

const { startCaptures, stopCaptures } = await import('./captureController')

describe('capture notices', () => {
  const reportNotice = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', { zanban: { audio: { reportNotice } } })
  })
  afterEach(() => {
    stopCaptures()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('reports system-unavailable when loopback capture fails', async () => {
    audio.startSystem.mockResolvedValue(null)
    await startCaptures({ systemEnabled: true })
    expect(reportNotice).toHaveBeenCalledWith({ kind: 'system-unavailable' })
  })

  it('stays quiet when system audio is off or starts fine', async () => {
    await startCaptures({ systemEnabled: false })
    stopCaptures()
    audio.startSystem.mockResolvedValue({ stop: () => {} })
    await startCaptures({ systemEnabled: true })
    expect(reportNotice).not.toHaveBeenCalled()
  })

  it('reports mic-silent from the silence watch and cancels it on stop', async () => {
    await startCaptures({ systemEnabled: false })
    audio.onSilent?.()
    expect(reportNotice).toHaveBeenCalledWith({ kind: 'mic-silent' })
    stopCaptures()
    expect(audio.cancelWatch).toHaveBeenCalled()
  })
})
