// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import type { ProviderTestResult } from '@shared/api'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { TestCall } from './TestCall'

const meter = vi.hoisted(() => ({
  onPeak: null as ((peak: number) => void) | null,
  stop: vi.fn()
}))
vi.mock('@renderer/audio/level', () => ({
  meterStream: (_stream: MediaStream, onPeak: (peak: number) => void) => {
    meter.onPeak = onPeak
    return meter.stop
  }
}))

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

const withKey: AppSettings = { ...DEFAULT_SETTINGS, vercelApiKey: 'vck_test' }

const track = { stop: vi.fn() }
const getUserMedia = vi.fn()
const testConnection = vi.fn<(id: string) => Promise<ProviderTestResult>>()

beforeEach(() => {
  meter.onPeak = null
  meter.stop.mockClear()
  track.stop.mockClear()
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] })
  testConnection.mockReset().mockResolvedValue({ ok: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true
  })
  vi.stubGlobal('zanban', { providers: { testConnection } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
  useTranscript.setState({ session: { kind: 'idle' } })
})

const runTest = () => fireEvent.click(screen.getByRole('button', { name: 'Test call' }))

describe('TestCall', () => {
  it('checks nothing until asked', () => {
    render(<TestCall settings={withKey} />)
    expect(screen.getByText(/About 20 seconds, and optional/)).toBeTruthy()
    expect(testConnection).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('passes when the AI answers and the microphone hears you, then lets go of the mic', async () => {
    render(<TestCall settings={withKey} />)
    runTest()
    expect(testConnection).toHaveBeenCalledWith('vercel-gateway')
    expect(await screen.findByText('Works')).toBeTruthy()

    expect(await screen.findByText(/Say a few words/)).toBeTruthy()
    await act(async () => meter.onPeak?.(0.4))
    expect(screen.getByText('We can hear you.')).toBeTruthy()
    expect(meter.stop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)

    cleanup()
    expect(meter.stop).toHaveBeenCalledTimes(1)
  })

  it('opens the microphone chosen in the audio step', async () => {
    const settings = { ...withKey, audio: { ...withKey.audio, micDeviceId: 'usb-mic' } }
    render(<TestCall settings={settings} />)
    runTest()
    await screen.findByText(/Say a few words/)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { ideal: 'usb-mic' } })
    })
  })

  it('says the key was rejected and where to fix it', async () => {
    testConnection.mockResolvedValue({ ok: false, reason: 'invalid_key', message: '401' })
    render(<TestCall settings={withKey} />)
    runTest()
    expect(await screen.findByText(/The key didn't work/)).toBeTruthy()
    expect(screen.getByText(/Fix the key on the Keys step/)).toBeTruthy()
  })

  it('points at the Keys step when no key is saved', async () => {
    testConnection.mockResolvedValue({ ok: false, message: 'No API key set' })
    render(<TestCall settings={DEFAULT_SETTINGS} />)
    runTest()
    expect(await screen.findByText("Doesn't work: No API key set")).toBeTruthy()
    expect(screen.getByText(/Fix the key on the Keys step/)).toBeTruthy()
  })

  it('suggests the connection for any other AI failure', async () => {
    testConnection.mockResolvedValue({ ok: false, message: 'fetch failed' })
    render(<TestCall settings={withKey} />)
    runTest()
    expect(await screen.findByText("Doesn't work: fetch failed")).toBeTruthy()
    expect(screen.getByText(/Check your internet connection/)).toBeTruthy()
  })

  it('tells an Ollama user to start Ollama', async () => {
    testConnection.mockResolvedValue({ ok: false, message: 'Ollama not reachable' })
    render(<TestCall settings={{ ...DEFAULT_SETTINGS, llmProvider: 'ollama' }} />)
    runTest()
    expect(testConnection).toHaveBeenCalledWith('ollama')
    expect(await screen.findByText(/Start Ollama/)).toBeTruthy()
  })

  it('fails a call that gets no answer within about 20 seconds', async () => {
    vi.useFakeTimers()
    testConnection.mockReturnValue(new Promise(() => {}))
    render(<TestCall settings={withKey} />)
    runTest()

    await act(async () => vi.advanceTimersByTimeAsync(19_000))
    expect(screen.getByText('checking…')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Test again' }).disabled).toBe(
      true
    )

    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(screen.getByText("Doesn't work: No answer in 20 seconds.")).toBeTruthy()
    expect(screen.getByText(/Check your internet connection/)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Test again' }).disabled).toBe(
      false
    )
  })

  it('gives a re-run its own 20 seconds before calling it stuck', async () => {
    vi.useFakeTimers()
    testConnection.mockResolvedValueOnce({ ok: true }).mockReturnValue(new Promise(() => {}))
    render(<TestCall settings={withKey} />)
    runTest()
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByText('Works')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))
    await act(async () => vi.advanceTimersByTimeAsync(10_500))
    expect(screen.queryByText(/No answer in 20 seconds/)).toBeNull()
    expect(screen.getByText('checking…')).toBeTruthy()

    await act(async () => vi.advanceTimersByTimeAsync(9_000))
    expect(screen.queryByText(/No answer in 20 seconds/)).toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByText("Doesn't work: No answer in 20 seconds.")).toBeTruthy()
  })

  it('ignores a late failure from a call it already gave up on', async () => {
    vi.useFakeTimers()
    let failFirst: (err: Error) => void = () => {}
    testConnection
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
      .mockResolvedValueOnce({ ok: true })
    render(<TestCall settings={withKey} />)
    runTest()
    await act(async () => vi.advanceTimersByTimeAsync(20_500))
    expect(screen.getByText("Doesn't work: No answer in 20 seconds.")).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByText('Works')).toBeTruthy()

    await act(async () => failFirst(new Error('socket hang up')))
    expect(screen.getByText('Works')).toBeTruthy()
    expect(screen.queryByText(/socket hang up/)).toBeNull()
  })

  it('keeps waiting for the newer call when the older one lands first', async () => {
    vi.useFakeTimers()
    let failFirst: (err: Error) => void = () => {}
    let answerSecond: (result: ProviderTestResult) => void = () => {}
    testConnection
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
      .mockReturnValueOnce(new Promise((resolve) => (answerSecond = resolve)))
    render(<TestCall settings={withKey} />)
    runTest()
    await act(async () => vi.advanceTimersByTimeAsync(20_500))
    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))

    await act(async () => failFirst(new Error('socket hang up')))
    expect(screen.getByText('checking…')).toBeTruthy()
    expect(screen.queryByText(/socket hang up/)).toBeNull()

    await act(async () => answerSecond({ ok: true }))
    expect(screen.getByText('Works')).toBeTruthy()
  })

  it('names a silent microphone', async () => {
    vi.useFakeTimers()
    render(<TestCall settings={withKey} />)
    runTest()
    await act(async () => vi.advanceTimersByTimeAsync(6_100))
    expect(screen.getByText(/No signal from this microphone/)).toBeTruthy()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('names a microphone that is too quiet', async () => {
    vi.useFakeTimers()
    render(<TestCall settings={withKey} />)
    runTest()
    await act(async () => vi.advanceTimersByTimeAsync(100))
    await act(async () => meter.onPeak?.(0.005))
    await act(async () => vi.advanceTimersByTimeAsync(6_100))
    expect(screen.getByText(/Very quiet/)).toBeTruthy()
  })

  it('says when the microphone cannot be opened', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'))
    render(<TestCall settings={withKey} />)
    runTest()
    expect(await screen.findByText(/Can't open the microphone \(Permission denied\)/)).toBeTruthy()
  })

  it('leaves a recording session alone and still checks the AI', async () => {
    useTranscript.setState({ session: { kind: 'running', sessionId: 's1', startedAt: 0 } })
    render(<TestCall settings={withKey} />)
    runTest()
    expect(await screen.findByText('Works')).toBeTruthy()
    expect(screen.getByText(/already in use/)).toBeTruthy()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('runs again from scratch', async () => {
    render(<TestCall settings={withKey} />)
    runTest()
    await screen.findByText(/Say a few words/)
    fireEvent.click(screen.getByRole('button', { name: 'Test again' }))
    expect(testConnection).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
