// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SessionDetailPayload } from '@shared/api'
import { DEFAULT_SETTINGS, type SessionState } from '@shared/types'
import type { GlobalActionItem, RecapPayload } from '@shared/recap-types'
import { initI18n } from '@renderer/lib/i18n'
import { useJobs } from '@renderer/features/jobs/jobsStore'
import { useSettingsStore } from '@renderer/features/settings/store'
import { useTranscript } from '@renderer/features/transcript/store'
import { DashboardApp } from './DashboardApp'

vi.mock('@renderer/audio/captureController', () => ({
  stopCaptures: vi.fn(),
  wireCaptureAutostop: () => () => undefined,
  startCapturesFromSettings: vi.fn()
}))

const NOW = Date.now()
const past = {
  id: 's1',
  title: 'Standup',
  startedAt: NOW - 7_200_000,
  endedAt: NOW - 5_400_000,
  durationMs: 1_800_000
}

function makeRecap(overrides: Partial<RecapPayload> = {}): RecapPayload {
  return {
    schemaVersion: 1,
    tldr: 'Planning went fine.',
    decisions: [],
    actionItems: [
      { text: 'Send the deck', owner: 'you' },
      { text: 'Book the room', owner: 'you' }
    ],
    openQuestions: [],
    followUp: null,
    generatedAt: NOW,
    model: 'mock',
    promptVersion: 1,
    ...overrides
  }
}

function makeSession(id: string): SessionDetailPayload {
  return {
    id,
    title: 'Roadmap review',
    startedAt: NOW - 600_000,
    endedAt: NOW,
    segments: [{ channel: 'mic', startMs: 0, text: 'Hello team' }],
    exchanges: [],
    filePath: '/x'
  }
}

function bus<T>() {
  const subscribers = new Set<(value: T) => void>()
  return {
    on(cb: (value: T) => void) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    emit(value: T) {
      act(() => subscribers.forEach((cb) => cb(value)))
    }
  }
}

// Subscriptions and unknown calls fall back to inert defaults so the shell can
// mount without every IPC method being spelled out here.
function inertNamespace(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, key) =>
        typeof key === 'string' && key.startsWith('on')
          ? () => () => undefined
          : async () => undefined
    }
  )
}

type JobList = Array<{ id: string; title: string; kind: 'other'; startedAt: number }>

interface Harness {
  sessionState: ReturnType<typeof bus<SessionState>>
  recapUpdated: ReturnType<typeof bus<string>>
  jobs: ReturnType<typeof bus<JobList>>
  recaps: Map<string, RecapPayload>
  stop: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
}

function mountDashboard(
  options: {
    recaps?: Record<string, RecapPayload>
    sessions?: Record<string, SessionDetailPayload>
    autoGenerate?: boolean
  } = {}
): Harness {
  const harness: Harness = {
    sessionState: bus<SessionState>(),
    recapUpdated: bus<string>(),
    jobs: bus<JobList>(),
    recaps: new Map(Object.entries(options.recaps ?? { s1: makeRecap() })),
    stop: vi.fn(async () => {
      harness.sessionState.emit({ kind: 'stopping' })
      harness.sessionState.emit({ kind: 'idle' })
    }),
    read: vi.fn(async (id: string) => options.sessions?.[id] ?? null)
  }
  const globalItems = (): GlobalActionItem[] =>
    [...harness.recaps].flatMap(([sessionId, recap]) =>
      sessionId === past.id
        ? recap.actionItems.map((a) => ({
            sessionId,
            sessionTitle: past.title,
            sessionStartedAt: past.startedAt,
            text: a.text
          }))
        : []
    )
  const api: Record<string, unknown> = {
    getVersion: async () => '0.0.0',
    settings: {
      get: async () => ({
        ...DEFAULT_SETTINGS,
        onboardingCompleted: true,
        recap: { ...DEFAULT_SETTINGS.recap, autoGenerate: options.autoGenerate ?? true }
      }),
      hotkeyConflicts: async () => [],
      onHotkeyConflict: () => () => undefined,
      onChanged: () => () => undefined
    },
    sessions: {
      list: async () => [past],
      read: harness.read
    },
    session: { stop: harness.stop, onState: harness.sessionState.on },
    recap: {
      get: async (id: string) => harness.recaps.get(id) ?? null,
      listActionItems: async () => globalItems(),
      onUpdated: harness.recapUpdated.on
    },
    jobs: { onState: harness.jobs.on }
  }
  vi.stubGlobal(
    'zanban',
    new Proxy(api, { get: (target, key) => target[key as string] ?? inertNamespace() })
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DashboardApp />
    </QueryClientProvider>
  )
  return harness
}

const running: SessionState = { kind: 'running', sessionId: 's2', startedAt: NOW - 600_000 }

beforeEach(() => {
  initI18n('en')
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useJobs.setState({ jobs: [], finished: new Set() })
  useSettingsStore.setState({ settings: null })
  useTranscript.getState().reset()
})

describe('DashboardApp meeting rows', () => {
  it('drops the open action item count the moment an item is checked off', async () => {
    mountDashboard()
    await screen.findByText(/2 open action items/)

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Mark done' })[0]!)

    expect(await screen.findByText(/1 open action item$/)).toBeInTheDocument()
    expect(screen.queryByText(/2 open action items/)).toBeNull()
  })
})

describe('DashboardApp after a call', () => {
  it('opens the stopped call on its Recap tab and fills it in when the recap lands', async () => {
    const h = mountDashboard({ sessions: { s2: makeSession('s2') } })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))

    expect(await screen.findByRole('tab', { name: 'Recap', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/writing recap/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate recap' })).toBeNull()

    h.jobs.emit([
      { id: 'recap-s2', title: 'Generating meeting recap', kind: 'other', startedAt: NOW }
    ])
    h.recaps.set('s2', makeRecap({ actionItems: [{ text: 'Share the roadmap', owner: 'you' }] }))
    h.recapUpdated.emit('s2')
    h.jobs.emit([])

    expect(await screen.findByText('Share the roadmap')).toBeInTheDocument()
    expect(screen.queryByText(/writing recap/)).toBeNull()
  })

  it('leads the opened recap with the action items', async () => {
    const h = mountDashboard({
      sessions: { s2: makeSession('s2') },
      recaps: { s1: makeRecap(), s2: makeRecap({ tldr: 'Roadmap agreed.' }) }
    })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))

    const tldr = await screen.findByText('Roadmap agreed.')
    const firstItem = screen.getByText('Send the deck')
    expect(firstItem.compareDocumentPosition(tldr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stops waiting and offers the generate button when the auto recap fails', async () => {
    const h = mountDashboard({ sessions: { s2: makeSession('s2') }, recaps: {} })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))
    await screen.findByText(/writing recap/)

    h.jobs.emit([
      { id: 'recap-s2', title: 'Generating meeting recap', kind: 'other', startedAt: NOW }
    ])
    h.jobs.emit([])

    expect(await screen.findByRole('button', { name: 'Generate recap' })).toBeInTheDocument()
    expect(screen.queryByText(/writing recap/)).toBeNull()
  })

  it('offers the generate button right away when auto-recap is off', async () => {
    const h = mountDashboard({
      sessions: { s2: makeSession('s2') },
      recaps: {},
      autoGenerate: false
    })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))

    expect(await screen.findByRole('button', { name: 'Generate recap' })).toBeInTheDocument()
    expect(screen.queryByText(/writing recap/)).toBeNull()
  })

  it('stays on the list when a call is stopped elsewhere and offers the recap instead', async () => {
    const h = mountDashboard({ sessions: { s2: makeSession('s2') }, recaps: {} })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)
    h.sessionState.emit({ kind: 'idle' })

    fireEvent.click(await screen.findByRole('button', { name: 'Open recap' }))

    expect(await screen.findByRole('tab', { name: 'Recap', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/writing recap/)).toBeInTheDocument()
    expect(h.stop).not.toHaveBeenCalled()
  })

  it('does not navigate on its own when a call is stopped elsewhere', async () => {
    const h = mountDashboard({ sessions: { s2: makeSession('s2') } })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)
    h.sessionState.emit({ kind: 'idle' })

    await screen.findByRole('button', { name: 'Open recap' })
    expect(screen.getAllByText('Standup').length).toBeGreaterThan(0)
    expect(screen.queryByRole('tab', { name: 'Recap' })).toBeNull()
  })

  it('drops the offer when the next call starts', async () => {
    const h = mountDashboard({ sessions: { s2: makeSession('s2') } })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)
    h.sessionState.emit({ kind: 'idle' })
    await screen.findByRole('button', { name: 'Open recap' })

    h.sessionState.emit({ kind: 'running', sessionId: 's3', startedAt: NOW })

    expect(screen.queryByRole('button', { name: 'Open recap' })).toBeNull()
  })

  it('drops the offer once that recap is opened from the list instead', async () => {
    const h = mountDashboard({ sessions: { s1: makeSession('s1') } })
    await screen.findAllByText('Standup')
    h.sessionState.emit({ kind: 'running', sessionId: 's1', startedAt: NOW })
    h.sessionState.emit({ kind: 'idle' })
    await screen.findByRole('button', { name: 'Open recap' })

    fireEvent.click(screen.getAllByText('Standup')[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))

    await screen.findByRole('button', { name: 'Start session' })
    expect(screen.queryByRole('button', { name: 'Open recap' })).toBeNull()
  })

  it('opens and offers nothing for a call that left no record', async () => {
    const h = mountDashboard({ sessions: {} })
    await screen.findAllByText('Standup')
    h.sessionState.emit(running)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))

    await waitFor(() => expect(h.read).toHaveBeenCalledWith('s2'))
    await act(async () => undefined)

    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open recap' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Recap' })).toBeNull()
  })
})
