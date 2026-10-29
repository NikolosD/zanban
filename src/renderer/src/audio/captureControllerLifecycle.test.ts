import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Handle {
  stop: ReturnType<typeof vi.fn>
}

const audio = vi.hoisted(() => ({
  startMic: vi.fn(),
  startSystem: vi.fn(),
  cancelWatch: vi.fn()
}))

vi.mock('./micCapture', () => ({
  startMic: (...args: unknown[]) => audio.startMic(...args),
  startSystem: (...args: unknown[]) => audio.startSystem(...args)
}))
vi.mock('./level', () => ({ watchMicSilence: () => audio.cancelWatch }))

let mod: typeof import('./captureController')
let notices: unknown[]
let devices: Array<{ kind: string; deviceId: string }>
let deviceListeners: Array<() => void>
let sessionListeners: Array<(state: { kind: string }) => void>
let enumerate: () => Promise<typeof devices>

function handle(): Handle {
  return { stop: vi.fn() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function plugDevices(...ids: string[]): void {
  devices = ids.map((deviceId) => ({ kind: 'audioinput', deviceId }))
}

function fireDeviceChange(): void {
  for (const cb of [...deviceListeners]) cb()
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  vi.resetModules()
  audio.startMic.mockReset()
  audio.startSystem.mockReset()
  audio.cancelWatch.mockReset()
  notices = []
  deviceListeners = []
  sessionListeners = []
  plugDevices('usb-headset', 'default')
  enumerate = async () => devices
  vi.stubGlobal('window', {
    zanban: {
      audio: { reportNotice: (notice: unknown) => notices.push(notice) },
      session: {
        onState: (cb: (state: { kind: string }) => void) => {
          sessionListeners.push(cb)
          return () => {
            sessionListeners = sessionListeners.filter((l) => l !== cb)
          }
        }
      }
    }
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      addEventListener: (_type: string, cb: () => void) => deviceListeners.push(cb),
      removeEventListener: (_type: string, cb: () => void) => {
        deviceListeners = deviceListeners.filter((l) => l !== cb)
      },
      enumerateDevices: () => enumerate()
    }
  })
  mod = await import('./captureController')
})

afterEach(() => {
  mod.stopCaptures()
  vi.unstubAllGlobals()
})

describe('starting and stopping capture', () => {
  it('releases a microphone that was granted after the call had already stopped', async () => {
    const pending = deferred<Handle>()
    audio.startMic.mockReturnValue(pending.promise)
    const starting = mod.startCaptures({ systemEnabled: false })

    mod.stopCaptures()
    const late = handle()
    pending.resolve(late)
    await starting

    expect(late.stop).toHaveBeenCalledTimes(1)
    expect(mod.captureCount()).toBe(0)
    expect(audio.cancelWatch).not.toHaveBeenCalled()
  })

  it('releases a loopback that was granted after the call had already stopped, along with the mic', async () => {
    const mic = handle()
    const pending = deferred<Handle | null>()
    audio.startMic.mockResolvedValue(mic)
    audio.startSystem.mockReturnValue(pending.promise)
    const starting = mod.startCaptures({ systemEnabled: true })
    await flush()

    mod.stopCaptures()
    const late = handle()
    pending.resolve(late)
    await starting

    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(late.stop).toHaveBeenCalledTimes(1)
    expect(mod.captureCount()).toBe(0)
  })

  it('ignores a second start while capture is already running', async () => {
    audio.startMic.mockResolvedValue(handle())

    await mod.startCaptures({ systemEnabled: false })
    await mod.startCaptures({ systemEnabled: false })

    expect(audio.startMic).toHaveBeenCalledTimes(1)
    expect(mod.captureCount()).toBe(1)
  })

  it('lets the user retry after the mic was denied, and shuts down what had started', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    audio.startMic.mockRejectedValueOnce(denied)

    await expect(mod.startCaptures({ systemEnabled: true })).rejects.toBe(denied)

    expect(mod.captureCount()).toBe(0)
    expect(audio.startSystem).not.toHaveBeenCalled()
    audio.startMic.mockResolvedValue(handle())
    await mod.startCaptures({ systemEnabled: false })
    expect(mod.captureCount()).toBe(1)
  })

  it('stops both captures and the silence watch, and can start again', async () => {
    const mic = handle()
    const system = handle()
    audio.startMic.mockResolvedValue(mic)
    audio.startSystem.mockResolvedValue(system)
    await mod.startCaptures({ systemEnabled: true })
    expect(mod.captureCount()).toBe(2)

    mod.stopCaptures()

    expect(mic.stop).toHaveBeenCalledTimes(1)
    expect(system.stop).toHaveBeenCalledTimes(1)
    expect(audio.cancelWatch).toHaveBeenCalledTimes(1)
    expect(mod.captureCount()).toBe(0)
    await mod.startCaptures({ systemEnabled: false })
    expect(audio.startMic).toHaveBeenCalledTimes(2)
  })

  it('passes the chosen device and the voice-activity gate to the mic only', async () => {
    audio.startMic.mockResolvedValue(handle())
    audio.startSystem.mockResolvedValue(handle())

    await mod.startCaptures({
      micDeviceId: 'usb-headset',
      systemEnabled: true,
      vad: { enabled: true, threshold: 0.3 }
    })

    expect(audio.startMic).toHaveBeenCalledWith('usb-headset', { enabled: true, threshold: 0.3 })
    expect(audio.startSystem).toHaveBeenCalledWith(undefined)
  })
})

describe('capture auto-stop', () => {
  it('stops capturing when the session goes idle but not while it runs', async () => {
    const mic = handle()
    audio.startMic.mockResolvedValue(mic)
    mod.wireCaptureAutostop()
    await mod.startCaptures({ systemEnabled: false })

    for (const cb of sessionListeners) cb({ kind: 'running' })
    expect(mic.stop).not.toHaveBeenCalled()
    for (const cb of sessionListeners) cb({ kind: 'idle' })

    expect(mic.stop).toHaveBeenCalledTimes(1)
  })

  it('wires once, and unwiring removes both listeners', () => {
    const off = mod.wireCaptureAutostop()
    const second = mod.wireCaptureAutostop()
    expect(sessionListeners).toHaveLength(1)
    expect(deviceListeners).toHaveLength(1)
    second()
    expect(deviceListeners).toHaveLength(1)

    off()
    expect(sessionListeners).toHaveLength(0)
    expect(deviceListeners).toHaveLength(0)
    mod.wireCaptureAutostop()
    expect(sessionListeners).toHaveLength(1)
  })
})

describe('unplugging the chosen microphone mid-call', () => {
  async function startPinned(): Promise<Handle> {
    const mic = handle()
    audio.startMic.mockResolvedValueOnce(mic)
    mod.wireCaptureAutostop()
    await mod.startCaptures({
      micDeviceId: 'usb-headset',
      systemEnabled: false,
      vad: { enabled: true, threshold: 0.2 }
    })
    return mic
  }

  it('moves to the default microphone and says so, keeping the voice gate', async () => {
    const pinned = await startPinned()
    const fallback = handle()
    audio.startMic.mockResolvedValueOnce(fallback)

    plugDevices('default')
    fireDeviceChange()
    await flush()

    expect(pinned.stop).toHaveBeenCalledTimes(1)
    expect(audio.startMic).toHaveBeenLastCalledWith(null, { enabled: true, threshold: 0.2 })
    expect(notices).toEqual([{ kind: 'mic-healed' }])
    expect(mod.captureCount()).toBe(1)

    fireDeviceChange()
    await flush()
    expect(audio.startMic).toHaveBeenCalledTimes(2)
  })

  it('does nothing while the chosen device is still plugged in', async () => {
    const pinned = await startPinned()

    fireDeviceChange()
    await flush()

    expect(audio.startMic).toHaveBeenCalledTimes(1)
    expect(pinned.stop).not.toHaveBeenCalled()
    expect(notices).toEqual([])
  })

  it('does nothing when the call is already on the default microphone', async () => {
    audio.startMic.mockResolvedValue(handle())
    mod.wireCaptureAutostop()
    await mod.startCaptures({ systemEnabled: false })

    plugDevices()
    fireDeviceChange()
    await flush()

    expect(audio.startMic).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([])
  })

  it('does nothing once the call has stopped', async () => {
    await startPinned()
    mod.stopCaptures()

    plugDevices('default')
    fireDeviceChange()
    await flush()

    expect(audio.startMic).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([])
  })

  it('tells the user the mic is lost when the default one cannot be opened either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pinned = await startPinned()
    audio.startMic.mockRejectedValueOnce(new Error('NotFoundError'))

    plugDevices('default')
    fireDeviceChange()
    await flush()

    expect(pinned.stop).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([{ kind: 'mic-lost' }])
    expect(mod.captureCount()).toBe(0)
  })

  it('keeps the old microphone when the device list cannot be read', async () => {
    const pinned = await startPinned()
    enumerate = async () => {
      throw new Error('InvalidStateError')
    }

    fireDeviceChange()
    await flush()

    expect(pinned.stop).not.toHaveBeenCalled()
    expect(audio.startMic).toHaveBeenCalledTimes(1)
  })

  it('opens only one replacement when several device changes arrive together', async () => {
    await startPinned()
    const replacement = deferred<Handle>()
    audio.startMic.mockReturnValueOnce(replacement.promise)

    plugDevices('default')
    fireDeviceChange()
    fireDeviceChange()
    fireDeviceChange()
    await flush()
    replacement.resolve(handle())
    await flush()

    expect(audio.startMic).toHaveBeenCalledTimes(2)
    expect(notices).toEqual([{ kind: 'mic-healed' }])
  })

  it('releases the replacement when the call stops while it was opening', async () => {
    await startPinned()
    const replacement = deferred<Handle>()
    audio.startMic.mockReturnValueOnce(replacement.promise)
    plugDevices('default')
    fireDeviceChange()
    await flush()

    mod.stopCaptures()
    const late = handle()
    replacement.resolve(late)
    await flush()

    expect(late.stop).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([])
    expect(mod.captureCount()).toBe(0)
  })

  it('does not reopen anything when the call stops while the device list is being read', async () => {
    await startPinned()
    const listing = deferred<typeof devices>()
    enumerate = () => listing.promise
    fireDeviceChange()
    await flush()

    mod.stopCaptures()
    listing.resolve([])
    await flush()

    expect(audio.startMic).toHaveBeenCalledTimes(1)
    expect(notices).toEqual([])
  })
})
