import { startMic, startSystem } from './micCapture'
import type { AppSettings } from '@shared/types'

interface Handle {
  stop(): void
}

let mic: Handle | null = null
let system: Handle | null = null
let wired = false

export async function startCaptures(args: {
  micDeviceId?: string | null
  systemEnabled: boolean
  vad?: { enabled: boolean; threshold: number }
}): Promise<void> {
  if (mic || system) return
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
  return window.zanban.session.onState((state) => {
    if (state.kind === 'idle') stopCaptures()
  })
}
