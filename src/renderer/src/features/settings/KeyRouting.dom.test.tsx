// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { ProvidersTab } from './ProvidersTab'

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

const filler = (n: number) => 'x'.repeat(n)
const GROQ = `gsk_${filler(44)}wxyz`
const ANTHROPIC = `sk-ant-api03-${filler(40)}`
const VERCEL = `vck_${filler(40)}`
const ELEVENLABS = `sk_${'a1'.repeat(24)}`
const TAVILY = `tvly-${filler(32)}`
const BARE_SK = `sk-${filler(48)}`
const storedKey = (tail: string) => `zanban-redacted:${tail}`

type Saved = Partial<AppSettings>

function Harness({
  initial,
  onUpdate
}: {
  initial: Partial<AppSettings>
  onUpdate<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS, ...initial })
  return (
    <ProvidersTab
      settings={settings}
      update={(key, value) => {
        onUpdate(key, value)
        setSettings((s) => ({ ...s, [key]: value }))
      }}
    />
  )
}

function renderTab(initial: Partial<AppSettings> = {}): Saved {
  const saved: Saved = {}
  render(
    <Harness
      initial={initial}
      onUpdate={(key, value) => {
        saved[key] = value
      }}
    />
  )
  return saved
}

function pasteAnywhere(text: string): HTMLInputElement {
  const input = screen.getByLabelText('Paste any key') as HTMLInputElement
  fireEvent.paste(input, { clipboardData: { getData: () => text } })
  return input
}

beforeEach(() => {
  vi.stubGlobal('zanban', {
    ollama: { health: vi.fn(async () => ({ running: false, host: '', models: [] })) },
    transcription: {
      speechModel: vi.fn(async () => ({ installed: true, missingBytes: 0 })),
      onSpeechModelProgress: () => () => {}
    }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('hint under a key field', () => {
  it('offers to move a key that belongs to another provider, then moves it', () => {
    const saved = renderTab()
    const field = screen.getByLabelText('Vercel AI Gateway key') as HTMLInputElement

    fireEvent.change(field, { target: { value: ` "${GROQ}"\n` } })
    const hint = screen.getByText('Looks like a key for Groq — move it there?')
    expect(hint.textContent).not.toContain(GROQ)

    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(saved.groqApiKey).toBe(GROQ)
    expect(saved.vercelApiKey).toBeNull()
    expect(field.value).toBe('')
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
    expect(screen.getByText('Moved to Groq.')).toBeTruthy()
    expect(document.body.textContent).not.toContain(GROQ)
  })

  it('says the move replaces a key that is already saved for that provider', () => {
    renderTab({ groqApiKey: storedKey('abcd') })
    const field = screen.getByLabelText('Vercel AI Gateway key')

    fireEvent.change(field, { target: { value: GROQ } })
    expect(
      screen.getByText('Looks like a key for Groq — move it there? It will replace the saved one.')
    ).toBeTruthy()
  })

  it('stays quiet for a key in its own field', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), { target: { value: VERCEL } })
    expect(screen.queryByText(/Looks like a key for/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
  })

  it('stays quiet when it cannot tell whose key it is', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), { target: { value: BARE_SK } })
    expect(screen.queryByText(/Looks like a key for/)).toBeNull()
  })

  it('also watches the web-search key field', () => {
    const saved = renderTab()
    const field = screen.getByLabelText('Tavily Search API') as HTMLInputElement

    fireEvent.change(field, { target: { value: ANTHROPIC } })
    expect(screen.getByText('Looks like a key for Anthropic Claude — move it there?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(saved.anthropicApiKey).toBe(ANTHROPIC)
    expect(saved.tavilyApiKey).toBeNull()
    expect(field.value).toBe('')
  })
})

describe('paste any key', () => {
  it('saves the key under its provider, empties the field and shows only a mask', () => {
    const saved = renderTab()
    const input = pasteAnywhere(`  '${GROQ}' `)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(input.value).toBe('')
    const status = screen.getByText('Saved as the Groq key · ••••wxyz')
    expect(status.textContent).not.toContain(GROQ)
    expect(document.body.textContent).not.toContain(GROQ)
  })

  it('offers to make the provider active when the active one has no key', () => {
    const saved = renderTab()
    pasteAnywhere(GROQ)
    expect(saved.llmProvider).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Use Groq for answers' }))
    expect(saved.llmProvider).toBe('groq')
    expect(screen.queryByRole('button', { name: 'Use Groq for answers' })).toBeNull()
  })

  it('does not offer a switch when the active provider already has a key', () => {
    const saved = renderTab({ vercelApiKey: storedKey('1234') })
    pasteAnywhere(GROQ)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
    expect(saved.llmProvider).toBeUndefined()
  })

  it('does not offer a switch when the key is for the provider already active', () => {
    renderTab()
    pasteAnywhere(VERCEL)
    expect(screen.getByText(/^Saved as the Vercel AI Gateway key/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
  })

  it('offers speech-to-text when the key is a speech provider and none is usable', () => {
    const saved = renderTab({ sttProvider: 'deepgram' })
    pasteAnywhere(ELEVENLABS)

    expect(saved.elevenlabsApiKey).toBe(ELEVENLABS)
    fireEvent.click(
      screen.getByRole('button', { name: 'Use ElevenLabs Scribe for speech-to-text' })
    )
    expect(saved.sttProvider).toBe('elevenlabs')
  })

  it('saves a web-search key without offering to activate anything', () => {
    const saved = renderTab()
    pasteAnywhere(TAVILY)

    expect(saved.tavilyApiKey).toBe(TAVILY)
    expect(screen.getByText(/^Saved as the Tavily Search API key/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
  })

  it('takes a typed key on Enter', () => {
    const saved = renderTab()
    const input = screen.getByLabelText('Paste any key') as HTMLInputElement

    fireEvent.change(input, { target: { value: ANTHROPIC } })
    expect(saved.anthropicApiKey).toBeUndefined()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(saved.anthropicApiKey).toBe(ANTHROPIC)
    expect(input.value).toBe('')
  })

  it('keeps nothing and says so when it cannot tell whose key it is', () => {
    const saved = renderTab()
    const input = pasteAnywhere(BARE_SK)

    expect(Object.keys(saved)).toEqual([])
    expect(input.value).toBe('')
    expect(screen.getByText(/Can't tell whose key this is/)).toBeTruthy()
    expect(document.body.textContent).not.toContain(BARE_SK)
  })

  it('ignores an empty paste', () => {
    const saved = renderTab()
    pasteAnywhere('  ')
    expect(Object.keys(saved)).toEqual([])
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('locales', () => {
  const keys = [
    'key_misplaced',
    'key_misplaced_replace',
    'key_move',
    'key_moved',
    'paste_any_title',
    'paste_any_hint',
    'paste_any_label',
    'paste_any_placeholder',
    'paste_any_saved',
    'paste_any_use_llm',
    'paste_any_use_stt',
    'paste_any_unknown'
  ]
  const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort()
  const text = (locale: { settings: { providers: Record<string, unknown> } }, key: string) =>
    String(locale.settings.providers[key] ?? '')

  it.each(keys)('has %s in English and Russian with the same placeholders', (key) => {
    const english = text(en, key)
    const russian = text(ru, key)
    expect(english).not.toBe('')
    expect(russian).not.toBe('')
    expect(placeholders(russian)).toEqual(placeholders(english))
  })
})
