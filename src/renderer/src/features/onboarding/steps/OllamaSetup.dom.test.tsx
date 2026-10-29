// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import type { OllamaHealth, OllamaPullProgress } from '@shared/api'
import { OllamaSetup } from './OllamaSetup'

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

function mockOllama(health: OllamaHealth) {
  let report: (p: OllamaPullProgress) => void = () => {}
  let finish: (ok: boolean) => void = () => {}
  const ollama = {
    health: vi.fn(async () => health),
    pull: vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve))),
    onPullProgress: (cb: (p: OllamaPullProgress) => void) => {
      report = cb
      return () => {}
    }
  }
  const openExternal = vi.fn(async () => true)
  vi.stubGlobal('zanban', { ollama, openExternal })
  return {
    ollama,
    openExternal,
    report: (p: OllamaPullProgress) => report(p),
    finish: (ok: boolean) => finish(ok)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const running = (models: string[]): OllamaHealth => ({ running: true, host: 'h', models })

describe('OllamaSetup', () => {
  it('points to the Ollama download when it is not running', async () => {
    const { openExternal } = mockOllama({ running: false, host: 'h', models: [] })
    render(<OllamaSetup host={null} />)
    fireEvent.click(await screen.findByText('Get Ollama'))
    expect(openExternal).toHaveBeenCalledWith('https://ollama.com/download')
  })

  it('confirms when the model is already there', async () => {
    mockOllama(running(['qwen3.5:9b']))
    render(<OllamaSetup host={null} />)
    expect(await screen.findByText('Ollama is running and qwen3.5:9b is installed.')).toBeTruthy()
  })

  it('downloads the missing model with progress, then checks again', async () => {
    const mock = mockOllama(running([]))
    render(<OllamaSetup host={null} />)
    fireEvent.click(await screen.findByText('Download qwen3.5:9b'))
    expect(mock.ollama.pull).toHaveBeenCalledWith('qwen3.5:9b')

    act(() => mock.report({ name: 'qwen3.5:9b', completed: 2e9, total: 6.6e9 }))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('30')
    expect(screen.getByText(/You can go on/)).toBeTruthy()

    mock.ollama.health.mockResolvedValue(running(['qwen3.5:9b']))
    await act(async () => mock.finish(true))
    expect(await screen.findByText('Ollama is running and qwen3.5:9b is installed.')).toBeTruthy()
  })
})
