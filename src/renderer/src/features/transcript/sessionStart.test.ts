import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@shared/types'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  toastError: vi.fn(),
  startCapturesFromSettings: vi.fn(),
  stopCaptures: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: h.toastError } }))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/audio/captureController', () => ({
  startCapturesFromSettings: h.startCapturesFromSettings,
  stopCaptures: h.stopCaptures
}))

const { startSessionWithCapture, resumeSession, toastSessionError } = await import('./sessionStart')
const { useTranscript } = await import('./store')

const settings = { audio: { micDeviceId: 'usb', systemEnabled: true } } as AppSettings
let api: {
  settings: { get: ReturnType<typeof vi.fn> }
  session: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  h.calls.length = 0
  h.toastError.mockReset()
  h.startCapturesFromSettings.mockReset().mockImplementation(async () => {
    h.calls.push('capture')
  })
  h.stopCaptures.mockReset().mockImplementation(() => {
    h.calls.push('stopCaptures')
  })
  api = {
    settings: { get: vi.fn(async () => settings) },
    session: {
      start: vi.fn(async () => {
        h.calls.push('session.start')
        return { sessionId: 's1' }
      }),
      stop: vi.fn(async () => {
        h.calls.push('session.stop')
      })
    }
  }
  vi.stubGlobal('window', { zanban: api })
  useTranscript.getState().reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startSessionWithCapture', () => {
  it('starts the session first and then the audio, with the settings it just read', async () => {
    await startSessionWithCapture()

    expect(h.calls).toEqual(['session.start', 'capture'])
    expect(api.session.start).toHaveBeenCalledWith(undefined)
    expect(h.startCapturesFromSettings).toHaveBeenCalledWith(settings)
  })

  it('asks main to resume the given session', async () => {
    await startSessionWithCapture('call-42')
    expect(api.session.start).toHaveBeenCalledWith({ resumeId: 'call-42' })
  })

  it('rolls the session back and rethrows when audio capture fails, so the overlay is not left recording nothing', async () => {
    const denied = new Error('Permission denied')
    h.startCapturesFromSettings.mockRejectedValueOnce(denied)

    await expect(startSessionWithCapture()).rejects.toBe(denied)

    expect(h.calls).toEqual(['session.start', 'stopCaptures', 'session.stop'])
  })

  it('still reports the capture error when the rollback itself fails', async () => {
    const denied = new Error('Permission denied')
    h.startCapturesFromSettings.mockRejectedValueOnce(denied)
    api.session.stop.mockRejectedValueOnce(new Error('already stopped'))

    await expect(startSessionWithCapture()).rejects.toBe(denied)
  })

  it('never starts audio when main refuses to start the session', async () => {
    const noKey = new Error(
      "Error invoking remote method 'session:start': Error: Deepgram API key not set."
    )
    api.session.start.mockRejectedValueOnce(noKey)

    await expect(startSessionWithCapture()).rejects.toBe(noKey)

    expect(h.startCapturesFromSettings).not.toHaveBeenCalled()
    expect(h.stopCaptures).toHaveBeenCalled()
  })

  it('does not start anything when settings cannot be read', async () => {
    api.settings.get.mockRejectedValueOnce(new Error('store locked'))

    await expect(startSessionWithCapture()).rejects.toThrow('store locked')

    expect(api.session.start).not.toHaveBeenCalled()
  })
})

describe('resumeSession', () => {
  it('refuses to resume while another call is running', async () => {
    useTranscript.getState().setSession({ kind: 'running', sessionId: 'live', startedAt: 1 })

    await resumeSession('old-call')

    expect(h.toastError).toHaveBeenCalledWith('dashboard.session_running_elsewhere')
    expect(api.session.start).not.toHaveBeenCalled()
  })

  it('resumes an idle session without any toast', async () => {
    await resumeSession('old-call')

    expect(api.session.start).toHaveBeenCalledWith({ resumeId: 'old-call' })
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('explains a failed resume and offers the Keys tab when a credential is missing', async () => {
    api.session.start.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'session:start': Error: Deepgram API key not set. Open Settings."
      )
    )
    const openSettings = vi.fn()

    await resumeSession('old-call', openSettings)

    const [title, options] = h.toastError.mock.calls[0]!
    expect(title).toBe('dashboard.could_not_resume')
    expect(options.description).toBe('Deepgram API key not set. Open Settings.')
    expect(options.action.label).toBe('common.open_settings')
    options.action.onClick()
    expect(openSettings).toHaveBeenCalledWith('keys')
  })
})

describe('toastSessionError', () => {
  it('offers no Settings shortcut for an error that Settings cannot fix', () => {
    toastSessionError('Could not start', new Error('Microphone is busy'), vi.fn())
    expect(h.toastError.mock.calls[0]![1].action).toBeUndefined()
  })

  it('offers no Settings shortcut when the caller cannot open Settings', () => {
    toastSessionError('Could not start', new Error('Deepgram API key not set. Open Settings.'))
    expect(h.toastError.mock.calls[0]![1].action).toBeUndefined()
  })
})
