// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'
import { isRedactedSecret, redactSettings, SECRET_SETTING_KEYS } from '@shared/settingsBoundary'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { ProvidersTab } from './ProvidersTab'
import { SettingsPanel } from './SettingsPanel'

void i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false }
})

const filler = (n: number) => 'x'.repeat(n)
const GROQ = `gsk_${filler(44)}wxyz`
const ANTHROPIC = `sk-ant-api03-${filler(40)}`
const OPENAI = `sk-proj-${filler(60)}`
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
  const notCancelled = fireEvent.paste(input, { clipboardData: { getData: () => text } })
  // Left alone, the browser would type the key into the field it was just cleared from.
  expect(notCancelled).toBe(false)
  return input
}

// Role queries crawl in happy-dom, so most tests find the buttons by label or text.
const moveTo = (provider: string) => screen.getByLabelText(`Move to ${provider}`)
const anyMove = () => screen.queryByLabelText(/^Move to /)
const useFor = (what: string) => screen.getByText(`Use ${what}`)
const anyUse = () => screen.queryByText(/^Use .+ for (answers|speech-to-text)$/)
const liveRegions = () => screen.getAllByRole('status', { hidden: true })

function expectNoKey(key: string) {
  expect(document.body.textContent).not.toContain(key)
  expect(document.body.innerHTML).not.toContain(key)
}

interface FakeMain {
  state: AppSettings
  patches: Array<Partial<AppSettings>>
  echoes: number
}

// Main as the settings panel meets it: keys saved from a patch, a redacted copy
// of everything broadcast back a moment later.
function installMain(initial: Partial<AppSettings> = {}): FakeMain {
  const main: FakeMain = { state: { ...DEFAULT_SETTINGS, ...initial }, patches: [], echoes: 0 }
  const listeners = new Set<(settings: AppSettings) => void>()
  vi.stubGlobal('zanban', {
    getVersion: async () => '0.0.0',
    settings: {
      get: async () => redactSettings(main.state),
      set: async (patch: Partial<AppSettings>) => {
        main.patches.push(structuredClone(patch))
        const writable: Record<string, unknown> = { ...patch }
        for (const key of SECRET_SETTING_KEYS) {
          if (isRedactedSecret(writable[key])) delete writable[key]
        }
        main.state = { ...main.state, ...writable } as AppSettings
        const next = redactSettings(main.state)
        setTimeout(() => {
          main.echoes += 1
          for (const listener of listeners) listener(next)
        }, 15)
        return next
      },
      onChanged: (listener: (settings: AppSettings) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      hotkeyConflicts: async () => [],
      onHotkeyConflict: () => () => {}
    },
    ollama: { health: async () => ({ running: false, host: '', models: [] }) },
    transcription: {
      speechModel: async () => ({ installed: true, missingBytes: 0 }),
      onSpeechModelProgress: () => () => {}
    },
    providers: {
      testConnection: async () => ({ ok: false, reason: 'invalid_key', message: 'rejected' }),
      testStt: async () => ({ ok: false, reason: 'invalid_key', message: 'rejected' })
    },
    ai: { availableModels: async () => null }
  })
  return main
}

async function mountPanel(): Promise<void> {
  render(<SettingsPanel initialTab="keys" />)
  await screen.findByLabelText('Paste any key')
  await act(async () => {})
}

// Waits out the panel's 350 ms save debounce and main's broadcast, then lets React render it.
async function untilEchoed(main: FakeMain, count: number): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(main.echoes).toBeGreaterThanOrEqual(count), { timeout: 3000 })
  })
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
    expect(hint.parentElement?.outerHTML).not.toContain(GROQ)

    fireEvent.click(moveTo('Groq'))
    expect(saved.groqApiKey).toBe(GROQ)
    expect(saved.vercelApiKey).toBeNull()
    expect(field.value).toBe('')
    expect(anyMove()).toBeNull()
    expect(screen.getByText('Moved to Groq.')).toBeTruthy()
    expectNoKey(GROQ)
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
    expect(anyMove()).toBeNull()
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

    fireEvent.click(moveTo('Anthropic Claude'))
    expect(saved.anthropicApiKey).toBe(ANTHROPIC)
    expect(saved.tavilyApiKey).toBeNull()
    expect(field.value).toBe('')
  })

  it('also watches the speech-to-text key fields', () => {
    const saved = renderTab({ sttProvider: 'deepgram' })
    const field = screen.getByLabelText('Deepgram API key') as HTMLInputElement

    fireEvent.change(field, { target: { value: GROQ } })
    expect(screen.getByText('Looks like a key for Groq — move it there?')).toBeTruthy()

    fireEvent.click(moveTo('Groq'))
    expect(saved.groqApiKey).toBe(GROQ)
    expect(saved.deepgramApiKey).toBeNull()
    expect(field.value).toBe('')
  })

  it('knows which speech-to-text field a key is at home in', () => {
    renderTab({ sttProvider: 'elevenlabs' })
    const field = screen.getByLabelText('ElevenLabs API key')

    fireEvent.change(field, { target: { value: ELEVENLABS } })
    expect(screen.queryByText(/Looks like a key for/)).toBeNull()

    fireEvent.change(field, { target: { value: ANTHROPIC } })
    expect(screen.getByText(/Looks like a key for Anthropic Claude/)).toBeTruthy()
  })

  it('counts an OpenAI key in the Whisper field as at home', () => {
    renderTab({ sttProvider: 'openai-whisper' })
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: OPENAI } })
    expect(screen.queryByText(/Looks like a key for/)).toBeNull()
  })

  it('moves a key without the comma or semicolon of the config line it came from', () => {
    const saved = renderTab()
    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), {
      target: { value: `"${GROQ}";` }
    })

    fireEvent.click(moveTo('Groq'))
    expect(saved.groqApiKey).toBe(GROQ)
  })

  it('refreshes another field that was showing a different key for the same provider', () => {
    const saved = renderTab({ llmProvider: 'anthropic', sttProvider: 'openai-whisper' })
    const whisper = screen.getByLabelText('OpenAI API key') as HTMLInputElement
    fireEvent.change(whisper, { target: { value: GROQ } })
    expect(screen.getByText(/Looks like a key for Groq/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: OPENAI } })
    fireEvent.click(moveTo('OpenAI'))

    expect(saved.openaiApiKey).toBe(OPENAI)
    expect(screen.queryByText(/Looks like a key for Groq/)).toBeNull()
    expect(whisper.value).toBe(OPENAI)
  })

  it('drops what a field shows when a key is saved there from elsewhere', () => {
    const saved = renderTab()
    const field = screen.getByLabelText('Tavily Search API') as HTMLInputElement
    fireEvent.change(field, { target: { value: GROQ } })
    expect(screen.getByText('Looks like a key for Groq — move it there?')).toBeTruthy()

    pasteAnywhere(TAVILY)

    expect(field.value).not.toBe(GROQ)
    expect(screen.queryByText(/Looks like a key for/)).toBeNull()
    expect(anyMove()).toBeNull()
    expect(saved.tavilyApiKey).toBe(TAVILY)
  })

  it('leaves a newer key alone when the field that still shows an older one is moved', () => {
    const saved = renderTab({ llmProvider: 'openai', sttProvider: 'openai-whisper' })
    const [llm, whisper] = screen.getAllByLabelText('OpenAI API key') as HTMLInputElement[]
    fireEvent.change(llm!, { target: { value: GROQ } })
    fireEvent.change(whisper!, { target: { value: OPENAI } })

    fireEvent.click(moveTo('Groq'))

    expect(saved.groqApiKey).toBe(GROQ)
    expect(saved.openaiApiKey).toBe(OPENAI)
    expect(llm!.value).toBe(OPENAI)
  })

  it('keeps each field typeable after another one was written to', () => {
    const saved = renderTab()
    const field = screen.getByLabelText('Tavily Search API') as HTMLInputElement
    pasteAnywhere(TAVILY)

    fireEvent.change(field, { target: { value: ANTHROPIC } })

    expect(field.value).toBe(ANTHROPIC)
    expect(screen.getByText(/Looks like a key for Anthropic Claude/)).toBeTruthy()
    expect(saved.tavilyApiKey).toBe(ANTHROPIC)
  })
})

describe('what assistive technology gets', () => {
  it('keeps its live regions on the page before they have anything to say', () => {
    renderTab()
    const before = liveRegions()
    expect(before.length).toBeGreaterThanOrEqual(3)
    for (const region of before) {
      expect(region.getAttribute('aria-live')).toBe('polite')
      expect(region.textContent).toBe('')
    }

    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), { target: { value: GROQ } })
    const hint = screen.getByText('Looks like a key for Groq — move it there?')
    expect(before).toContain(hint)

    pasteAnywhere(ANTHROPIC)
    const confirmation = screen.getByText(/^Saved as the Anthropic Claude key/)
    expect(before).toContain(confirmation)
  })

  it('keeps the buttons outside the live regions', () => {
    renderTab()
    pasteAnywhere(ANTHROPIC)
    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), { target: { value: GROQ } })

    const move = screen.getByRole('button', { name: 'Move to Groq', hidden: true })
    const use = screen.getByRole('button', {
      name: 'Use Anthropic Claude for answers',
      hidden: true
    })
    expect(move.closest('[role="status"]')).toBeNull()
    expect(use.closest('[role="status"]')).toBeNull()
    for (const region of liveRegions()) {
      expect(region.querySelector('button')).toBeNull()
    }
  })

  it('names Move after where it moves the key, while still reading Move', () => {
    renderTab()
    fireEvent.change(screen.getByLabelText('Vercel AI Gateway key'), { target: { value: GROQ } })
    const move = screen.getByRole('button', { name: 'Move to Groq', hidden: true })
    expect(move.textContent).toBe('Move')
  })

  it('puts focus back in the field after Move', () => {
    renderTab()
    const field = screen.getByLabelText('Vercel AI Gateway key')
    fireEvent.change(field, { target: { value: GROQ } })
    const move = moveTo('Groq')
    move.focus()

    fireEvent.click(move)

    expect(document.activeElement).toBe(field)
  })

  it('puts focus back in the paste field after Use', () => {
    renderTab()
    const input = pasteAnywhere(GROQ)
    const use = useFor('Groq for answers')
    use.focus()

    fireEvent.click(use)

    expect(document.activeElement).toBe(input)
  })
})

describe('paste any key', () => {
  it('saves the key under its provider, empties the field and shows only a mask', () => {
    const saved = renderTab()
    const input = pasteAnywhere(`  '${GROQ}' `)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(input.value).toBe('')
    const status = screen.getByText('Saved as the Groq key · ••••wxyz')
    expect(status.parentElement?.outerHTML).not.toContain(GROQ)
    expectNoKey(GROQ)
  })

  it('drops the comma or semicolon of a copied config line', () => {
    const saved = renderTab()
    pasteAnywhere(`"${GROQ}",`)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(screen.getByText('Saved as the Groq key · ••••wxyz')).toBeTruthy()
  })

  it('says so when it replaces a key that is already saved', () => {
    const saved = renderTab({ groqApiKey: storedKey('abcd') })
    pasteAnywhere(GROQ)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(screen.getByText('Replaced the saved Groq key · ••••wxyz')).toBeTruthy()
    expect(screen.queryByText(/^Saved as/)).toBeNull()
  })

  it('offers to make the provider active when the active one has no key', () => {
    const saved = renderTab()
    pasteAnywhere(GROQ)
    expect(saved.llmProvider).toBeUndefined()

    fireEvent.click(useFor('Groq for answers'))
    expect(saved.llmProvider).toBe('groq')
    expect(screen.queryByText('Use Groq for answers')).toBeNull()
  })

  it('does not offer a switch when the active provider already has a key', () => {
    const saved = renderTab({ vercelApiKey: storedKey('1234') })
    pasteAnywhere(GROQ)

    expect(saved.groqApiKey).toBe(GROQ)
    expect(anyUse()).toBeNull()
    expect(saved.llmProvider).toBeUndefined()
  })

  it('does not offer a switch when the key is for the provider already active', () => {
    renderTab()
    pasteAnywhere(VERCEL)
    expect(screen.getByText(/^Saved as the Vercel AI Gateway key/)).toBeTruthy()
    expect(anyUse()).toBeNull()
  })

  it('offers speech-to-text when the key is a speech provider and none is usable', () => {
    const saved = renderTab({ sttProvider: 'deepgram' })
    pasteAnywhere(ELEVENLABS)

    expect(saved.elevenlabsApiKey).toBe(ELEVENLABS)
    fireEvent.click(useFor('ElevenLabs Scribe for speech-to-text'))
    expect(saved.sttProvider).toBe('elevenlabs')
  })

  it('saves a web-search key without offering to activate anything', () => {
    const saved = renderTab()
    pasteAnywhere(TAVILY)

    expect(saved.tavilyApiKey).toBe(TAVILY)
    expect(screen.getByText(/^Saved as the Tavily Search API key/)).toBeTruthy()
    expect(anyUse()).toBeNull()
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
    expectNoKey(BARE_SK)
  })

  it('ignores an empty paste', () => {
    const saved = renderTab()
    pasteAnywhere('  ')
    expect(Object.keys(saved)).toEqual([])
    for (const region of liveRegions()) expect(region.textContent).toBe('')
  })
})

describe('through the real settings panel', () => {
  it('keeps offering the move after the typed key was saved and echoed back', async () => {
    const main = installMain()
    await mountPanel()
    const field = screen.getByLabelText('Vercel AI Gateway key') as HTMLInputElement

    fireEvent.change(field, { target: { value: GROQ } })
    await untilEchoed(main, 1)
    expect(main.state.vercelApiKey).toBe(GROQ)
    expect(screen.getByText('Looks like a key for Groq — move it there?')).toBeTruthy()

    fireEvent.click(moveTo('Groq'))
    await untilEchoed(main, 2)

    expect(main.patches[1]).toEqual({ groqApiKey: GROQ, vercelApiKey: null })
    expect(main.state.groqApiKey).toBe(GROQ)
    expect(main.state.vercelApiKey).toBeNull()
    expect(field.value).toBe('')
    expect(screen.getByText('Moved to Groq.')).toBeTruthy()
    expectNoKey(GROQ)
  })

  it('does not let Move delete a key that was saved into the field from elsewhere', async () => {
    const main = installMain()
    await mountPanel()
    const field = screen.getByLabelText('Tavily Search API') as HTMLInputElement

    fireEvent.change(field, { target: { value: GROQ } })
    await untilEchoed(main, 1)
    expect(screen.getByText('Looks like a key for Groq — move it there?')).toBeTruthy()

    pasteAnywhere(TAVILY)
    await untilEchoed(main, 2)

    expect(screen.queryByText(/Looks like a key for/)).toBeNull()
    expect(anyMove()).toBeNull()
    expect(main.patches).toEqual([{ tavilyApiKey: GROQ }, { tavilyApiKey: TAVILY }])
    expect(main.state.tavilyApiKey).toBe(TAVILY)
    expect(field.value).toBe('')
    expect(field.placeholder).toBe('configured · ••••xxxx')
  })
})

describe('locales', () => {
  const keys = [
    'key_misplaced',
    'key_misplaced_replace',
    'key_move',
    'key_move_to',
    'key_moved',
    'paste_any_title',
    'paste_any_hint',
    'paste_any_label',
    'paste_any_placeholder',
    'paste_any_saved',
    'paste_any_replaced',
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
