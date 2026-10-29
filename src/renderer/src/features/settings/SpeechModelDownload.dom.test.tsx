// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import type { SpeechModelStatus } from '@shared/api'
import { SpeechModelDownload } from './SpeechModelDownload'

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

const MISSING: SpeechModelStatus = { installed: false, missingBytes: 672_000_000 }
const INSTALLED: SpeechModelStatus = { installed: true, missingBytes: 0 }

function mockTranscription(status: SpeechModelStatus) {
  let report: (fraction: number) => void = () => {}
  let finish: (err?: Error) => void = () => {}
  const transcription = {
    speechModel: vi.fn(async () => status),
    downloadSpeechModel: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => (finish = (err) => (err ? reject(err) : resolve())))
    ),
    onSpeechModelProgress: (cb: (fraction: number) => void) => {
      report = cb
      return () => {}
    }
  }
  vi.stubGlobal('zanban', { transcription })
  return {
    transcription,
    report: (fraction: number) => report(fraction),
    finish: (err?: Error) => finish(err)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SpeechModelDownload', () => {
  it('says so when the model is already downloaded', async () => {
    mockTranscription(INSTALLED)
    render(<SpeechModelDownload />)
    expect(await screen.findByText(/The speech model is downloaded/)).toBeTruthy()
  })

  it('downloads the model with progress, then shows it installed', async () => {
    const mock = mockTranscription(MISSING)
    render(<SpeechModelDownload />)
    fireEvent.click(await screen.findByText('Download the model now · 672 MB'))
    expect(mock.transcription.downloadSpeechModel).toHaveBeenCalled()

    act(() => mock.report(0.25))
    expect(screen.getByText('Downloading speech model · 168 MB of 672 MB (25%)')).toBeTruthy()

    mock.transcription.speechModel.mockResolvedValue(INSTALLED)
    await act(async () => mock.finish())
    expect(await screen.findByText(/The speech model is downloaded/)).toBeTruthy()
  })

  it('shows why a download failed and offers it again', async () => {
    const mock = mockTranscription(MISSING)
    render(<SpeechModelDownload />)
    fireEvent.click(await screen.findByText('Download the model now · 672 MB'))
    await act(async () => mock.finish(new Error('Speech model download failed (503)')))
    expect(
      await screen.findByText("Couldn't download the model: Speech model download failed (503)")
    ).toBeTruthy()
    expect(screen.getByText('Download the model now · 672 MB')).toBeTruthy()
  })
})
