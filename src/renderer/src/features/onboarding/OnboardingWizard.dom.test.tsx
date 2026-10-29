// @vitest-environment happy-dom
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { OnboardingWizard } from './OnboardingWizard'

vi.mock('@renderer/audio/level', () => ({ meterStream: () => () => {} }))

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

let applyPatch: (patch: Partial<AppSettings>) => void = () => {}
let reportSpeechProgress: (fraction: number) => void = () => {}

const settingsSet = vi.fn(async (patch: Partial<AppSettings>) => {
  applyPatch(patch)
  return DEFAULT_SETTINGS
})
const downloadSpeechModel = vi.fn(() => new Promise<void>(() => {}))
const speechModel = vi.fn(async () => ({ installed: false, missingBytes: 672_000_000 }))
const testConnection = vi.fn(async () => ({ ok: true }))
const onClose = vi.fn()

function Wizard({ initial = DEFAULT_SETTINGS }: { initial?: AppSettings }) {
  const [settings, setSettings] = useState(initial)
  useEffect(() => {
    applyPatch = (patch) => setSettings((s) => ({ ...s, ...patch }))
  }, [])
  return <OnboardingWizard open settings={settings} onClose={onClose} />
}

beforeEach(() => {
  settingsSet.mockClear()
  downloadSpeechModel.mockClear()
  speechModel.mockClear()
  testConnection.mockClear()
  onClose.mockClear()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockRejectedValue(new Error('denied')),
      enumerateDevices: vi.fn(async () => [])
    },
    configurable: true
  })
  vi.stubGlobal('zanban', {
    settings: { set: settingsSet },
    transcription: {
      speechModel,
      downloadSpeechModel,
      onSpeechModelProgress: (cb: (fraction: number) => void) => {
        reportSpeechProgress = cb
        return () => {}
      }
    },
    providers: { testConnection },
    ollama: {
      health: vi.fn(async () => ({ running: true, host: 'h', models: ['qwen3.5:9b'] })),
      pull: vi.fn(() => new Promise<boolean>(() => {})),
      onPullProgress: () => () => {}
    }
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const steps = () => screen.getAllByRole('listitem').map((li) => li.textContent)

describe('OnboardingWizard', () => {
  it('walks four steps and never asks for a language or a role', async () => {
    render(<Wizard />)
    expect(steps()).toEqual(['1Setup', '2Keys', '3Audio', '4Done'])
    expect(screen.queryByText('Welcome to Zanban')).toBeNull()
    expect(screen.queryByText('What do you do?')).toBeNull()

    click('Next')
    await screen.findByText('Add your keys')
    click('Next')
    await screen.findByText('Check your audio')
    click('Next')
    expect(screen.getByRole('button', { name: 'Test call' })).toBeTruthy()
    expect(screen.getByText(/Pick your role in Settings → Context/)).toBeTruthy()
    expect(screen.queryByText('What do you do?')).toBeNull()

    click('Finish')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(settingsSet).toHaveBeenCalledWith({ onboardingCompleted: true })
    expect(testConnection).not.toHaveBeenCalled()
  })

  it('keeps the setup choice and its speech engine out of the keys step', async () => {
    render(<Wizard />)
    click('Next')
    await screen.findByText('Add your keys')
    expect(screen.getByText('Vercel AI Gateway key')).toBeTruthy()
    expect(screen.queryByText('Deepgram')).toBeNull()
    expect(screen.queryByText('Google Speech-to-Text')).toBeNull()
    expect(screen.queryByRole('button', { name: /On-device/ })).toBeNull()
  })

  it('downloads the speech model in the background from the moment a local engine is chosen', async () => {
    render(<Wizard />)
    expect(speechModel).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).toBeNull()

    click('Next')
    await vi.waitFor(() => expect(downloadSpeechModel).toHaveBeenCalledTimes(1))
    act(() => reportSpeechProgress(0.25))
    expect(screen.getByText('Downloading speech model · 168 MB of 672 MB (25%)')).toBeTruthy()

    await screen.findByText('Add your keys')
    click('Next')
    await screen.findByText('Check your audio')
    click('Next')
    act(() => reportSpeechProgress(0.5))
    expect(screen.getByText('Downloading speech model · 336 MB of 672 MB (50%)')).toBeTruthy()
    expect(downloadSpeechModel).toHaveBeenCalledTimes(1)
  })

  it('asks cloud speech only for its key and downloads nothing', async () => {
    render(<Wizard />)
    fireEvent.click(screen.getByRole('button', { name: /Best quality/ }))
    click('Next')
    await screen.findByText('Add your keys')
    expect(screen.getByText('ElevenLabs API key')).toBeTruthy()
    expect(screen.queryByText('Deepgram')).toBeNull()
    expect(screen.queryByRole('button', { name: /On-device/ })).toBeNull()
    expect(downloadSpeechModel).not.toHaveBeenCalled()
  })

  it('treats the private setup like any preset: no picker, local speech downloads', async () => {
    render(<Wizard />)
    fireEvent.click(screen.getByRole('button', { name: /Fully private/ }))
    click('Next')
    await screen.findByText('Add your keys')
    expect(screen.queryByText('Deepgram')).toBeNull()
    await vi.waitFor(() => expect(downloadSpeechModel).toHaveBeenCalledTimes(1))
  })

  it('shows the speech choice for a manual setup and downloads only once on-device is picked', async () => {
    render(<Wizard />)
    fireEvent.click(screen.getByRole('button', { name: /Set up manually/ }))
    click('Next')
    await screen.findByText('Add your keys')
    expect(screen.getByRole('button', { name: /Deepgram/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /On-device/ })).toBeTruthy()
    expect(downloadSpeechModel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /On-device/ }))
    await vi.waitFor(() => expect(downloadSpeechModel).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /Deepgram/ }))
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('switches the interface language from the header', () => {
    render(<Wizard />)
    const en = screen.getByRole('button', { name: 'EN' })
    const ru = screen.getByRole('button', { name: 'RU' })
    expect(en.getAttribute('aria-pressed')).toBe('true')
    expect(ru.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(ru)
    expect(settingsSet).toHaveBeenCalledWith({ uiLocale: 'ru' })
  })
})
