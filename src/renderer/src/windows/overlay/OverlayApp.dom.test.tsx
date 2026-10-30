// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'
import { DEFAULT_SETTINGS, type AppSettings, type AudioChannel } from '@shared/types'
import { useAi } from '@renderer/features/ai/store'
import { AUTO_ANSWER_SILENCE_MS } from '@renderer/features/ai/useAutoAnswer'
import { useSettingsStore } from '@renderer/features/settings/store'
import { useTranscript } from '@renderer/features/transcript/store'
import { OverlayApp } from './OverlayApp'

vi.mock('@renderer/audio/captureController', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/audio/captureController')>()),
  wireCaptureAutostop: () => () => {}
}))

const QUESTION = 'What is your experience with React?'
const NEXT_QUESTION = 'And how long did that project take?'

interface Bridge {
  ask: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  settingsChanged(settings: AppSettings): void
  visibilityChanged(visible: boolean): void
}

let settingsListener: (settings: AppSettings) => void = () => {}
let visibilityListener: (visible: boolean) => void = () => {}
let nextId = 0

function stubBridge(
  autoAnswer: boolean,
  ask: (arg: { requestId: string }) => Promise<unknown> = async ({ requestId }) => ({ requestId })
): Bridge {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, autoAnswer }
  const askFn = vi.fn(ask)
  const set = vi.fn(async () => settings)
  const overrides: Record<string, unknown> = {
    'settings.get': async () => settings,
    'settings.set': set,
    'settings.onChanged': (cb: typeof settingsListener) => {
      settingsListener = cb
      return () => {}
    },
    'overlay.getStealth': async () => true,
    'overlay.onVisibilityChanged': (cb: typeof visibilityListener) => {
      visibilityListener = cb
      return () => {}
    },
    'ai.ask': askFn,
    'ai.stop': async () => {}
  }
  const namespace = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_target, method: string) =>
        overrides[`${name}.${method}`] ??
        (/^on[A-Z]/.test(method) ? () => () => {} : async () => undefined)
    })
  vi.stubGlobal(
    'zanban',
    new Proxy({} as Record<string, unknown>, { get: (_target, name: string) => namespace(name) })
  )
  return {
    ask: askFn,
    set,
    settingsChanged: (next) => act(() => settingsListener(next)),
    visibilityChanged: (visible) => act(() => visibilityListener(visible))
  }
}

async function mountOverlay(): Promise<void> {
  render(<OverlayApp />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function startSession(): void {
  act(() => useTranscript.getState().setSession({ kind: 'running', sessionId: 's1', startedAt: 0 }))
}

function hear(text: string, channel: AudioChannel = 'system', isFinal = true): void {
  act(() =>
    useTranscript.getState().pushSegment({
      id: `seg-${nextId++}`,
      channel,
      speaker: 0,
      startMs: 0,
      endMs: 0,
      text,
      isFinal,
      createdAt: Date.now()
    })
  )
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru } },
    interpolation: { escapeValue: false }
  })
})

beforeEach(() => {
  vi.useFakeTimers()
  useTranscript.setState({
    finals: [],
    partials: { mic: null, system: null },
    session: { kind: 'idle' },
    lastUpdateAt: null,
    lastFinalAt: null
  })
  useAi.getState().reset()
  useSettingsStore.setState({ settings: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OverlayApp auto-answer', () => {
  it('answers a detected question the way the Answer button does, and shows what it answered', async () => {
    const bridge = stubBridge(true)
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)

    expect(bridge.ask).toHaveBeenCalledTimes(1)
    expect(bridge.ask.mock.lastCall![0]).toMatchObject({ prompt: ANSWER_LAST_PROMPT })
    expect(useAi.getState().messages[0]).toMatchObject({
      prompt: 'Answer last question',
      question: QUESTION
    })
    expect(screen.getByText(`Q: ${QUESTION}`)).toBeTruthy()
  })

  it('shows the question it caught, not everything the other side said', async () => {
    stubBridge(true)
    await mountOverlay()
    startSession()
    hear('Thanks for joining. Why did you choose Postgres over Mongo')
    await wait(AUTO_ANSWER_SILENCE_MS * 2)

    expect(useAi.getState().messages[0]?.question).toBe('Why did you choose Postgres over Mongo')
    expect(screen.getByText('Q: Why did you choose Postgres over Mongo')).toBeTruthy()
  })

  it('lets the transcript settle first, as the Answer button does', async () => {
    const bridge = stubBridge(true)
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS - 100)
    hear('Sure, so I would say', 'mic', false)
    await wait(100)
    expect(bridge.ask).not.toHaveBeenCalled()

    await wait(600)
    expect(bridge.ask).toHaveBeenCalledTimes(1)
  })

  it('does nothing while Auto-answer is off', async () => {
    const bridge = stubBridge(false)
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS * 3)

    expect(bridge.ask).not.toHaveBeenCalled()
  })

  it('follows the setting as it changes, even while a question is waiting', async () => {
    const bridge = stubBridge(false)
    await mountOverlay()
    startSession()
    bridge.settingsChanged({ ...DEFAULT_SETTINGS, autoAnswer: true })
    hear(QUESTION)
    await wait(600)
    bridge.settingsChanged({ ...DEFAULT_SETTINGS, autoAnswer: false })
    await wait(AUTO_ANSWER_SILENCE_MS * 3)
    expect(bridge.ask).not.toHaveBeenCalled()

    bridge.settingsChanged({ ...DEFAULT_SETTINGS, autoAnswer: true })
    hear(NEXT_QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    expect(bridge.ask).toHaveBeenCalledTimes(1)
  })

  it('does not spend on questions asked while the overlay is hidden', async () => {
    const bridge = stubBridge(true)
    await mountOverlay()
    startSession()
    bridge.visibilityChanged(false)
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS * 3)
    expect(bridge.ask).not.toHaveBeenCalled()

    bridge.visibilityChanged(true)
    await wait(AUTO_ANSWER_SILENCE_MS * 3)
    expect(bridge.ask).not.toHaveBeenCalled()

    hear(NEXT_QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    expect(bridge.ask).toHaveBeenCalledTimes(1)
    expect(useAi.getState().messages[0]?.question).toBe(NEXT_QUESTION)
  })

  it('drops a question that is waiting when the overlay is hidden', async () => {
    const bridge = stubBridge(true)
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(600)
    bridge.visibilityChanged(false)
    await wait(AUTO_ANSWER_SILENCE_MS * 3)

    expect(bridge.ask).not.toHaveBeenCalled()
  })

  it('does not ask again while the last ask is still being dispatched', async () => {
    const release: Array<() => void> = []
    const bridge = stubBridge(
      true,
      ({ requestId }) => new Promise((r) => release.push(() => r({ requestId })))
    )
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    expect(bridge.ask).toHaveBeenCalledTimes(1)
    act(() => useAi.getState().finishRequest(useAi.getState().messages[0]!.id, 'stop'))

    hear(NEXT_QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    expect(bridge.ask).toHaveBeenCalledTimes(1)

    await act(async () => release[0]!())
    hear(NEXT_QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    expect(bridge.ask).toHaveBeenCalledTimes(2)
  })

  it('folds an answered question into one line above the next', async () => {
    stubBridge(true)
    await mountOverlay()
    startSession()
    hear(QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)
    act(() => useAi.getState().finishRequest(useAi.getState().messages[0]!.id, 'stop'))
    hear(NEXT_QUESTION)
    await wait(AUTO_ANSWER_SILENCE_MS)

    expect(screen.getByText(`Q: ${NEXT_QUESTION}`)).toBeTruthy()
    expect(screen.getByText(QUESTION)).toBeTruthy()
  })
})
