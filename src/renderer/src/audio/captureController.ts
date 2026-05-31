import { startMic, startSystem } from './micCapture'
import type { AppSettings } from '@shared/types'

interface Handle {
  stop(): void
}

interface StartArgs {
  micDeviceId?: string | null
  systemEnabled: boolean
  vad?: { enabled: boolean; threshold: number }
}

let mic: Handle | null = null
let system: Handle | null = null
let wired = false
let lastArgs: StartArgs | null = null

export interface CaptureNotice {
  kind: 'mic-healed' | 'mic-lost'
  message: string
}
const noticeListeners = new Set<(n: CaptureNotice) => void>()

/** Subscribe to capture-health notices (e.g. mic auto-heal). Returns an unsubscribe. */
export function onCaptureNotice(cb: (n: CaptureNotice) => void): () => void {
  noticeListeners.add(cb)
  return () => noticeListeners.delete(cb)
}
function emitNotice(n: CaptureNotice): void {
  for (const cb of noticeListeners) cb(n)
}

export async function startCaptures(args: StartArgs): Promise<void> {
  if (mic || system) return
  lastArgs = args
  mic = await startMic(args.micDeviceId, args.vad)
  if (args.systemEnabled) {
    // No VAD on the system channel — see startCapturesFromSettings comment.
    system = await startSystem(undefined)
  }
}

export function stopCaptures(): void {
  mic?.stop()
  system?.stop()
  mic = null
  system = null
  lastArgs = null
}

/**
 * If the active mic session was pinned to a specific device that just
 * disappeared (unplugged headset / Bluetooth drop), restart capture on the
 * default device so the session keeps recording instead of going silent.
 */
async function healMicIfDeviceLost(): Promise<void> {
  if (!mic || !lastArgs) return
  const wantedId = lastArgs.micDeviceId
  if (!wantedId) return // already on default — nothing pinned to lose
  let devices: MediaDeviceInfo[]
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return
  }
  const stillThere = devices.some((d) => d.kind === 'audioinput' && d.deviceId === wantedId)
  if (stillThere) return
  try {
    mic.stop()
    mic = await startMic(null, lastArgs.vad)
    emitNotice({
      kind: 'mic-healed',
      message: 'Микрофон отключён — переключился на устройство по умолчанию'
    })
  } catch (err) {
    console.warn('[audio] mic auto-heal failed', err)
    emitNotice({ kind: 'mic-lost', message: 'Микрофон отключён, переподключиться не удалось' })
  }
}

export function captureCount(): number {
  return (mic ? 1 : 0) + (system ? 1 : 0)
}

/**
 * Start captures using values pulled from settings — saves every call site
 * from re-spelling the same `{ micDeviceId, systemEnabled, vad }` shape.
 */
export async function startCapturesFromSettings(settings: AppSettings): Promise<void> {
  // VAD is only applied to the mic channel — the other speaker comes through
  // the system loopback, often at much lower amplitude (Zoom auto-gain, music
  // sting, UI bleeps) and an energy gate clobbers it. The cost of always
  // streaming system audio is bandwidth on one channel, which is worth it.
  await startCaptures({
    micDeviceId: settings.audio.micDeviceId,
    systemEnabled: settings.audio.systemEnabled,
    vad: { enabled: settings.audio.vadEnabled, threshold: settings.audio.vadThreshold }
  })
}

export function wireCaptureAutostop(): () => void {
  if (wired) return () => {}
  wired = true
  const offState = window.zanban.session.onState((state) => {
    if (state.kind === 'idle') stopCaptures()
  })
  const onDeviceChange = (): void => void healMicIfDeviceLost()
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
  return () => {
    offState()
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    wired = false
  }
}
