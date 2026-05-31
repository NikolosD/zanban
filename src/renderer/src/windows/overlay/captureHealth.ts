import type { AudioChannel, TranscriptionStatus } from '@shared/types'

/**
 * Discrete per-channel capture health shown as a status dot in the HUD. Kept
 * coarse on purpose — three states the user can read at a glance:
 *   - `error`     — the STT socket errored; nothing is being transcribed.
 *   - `connecting`— socket opening, not ready yet.
 *   - `speaking`  — we're actively hearing this channel right now.
 *   - `idle`      — connected/quiet, or not started.
 */
export type CaptureState = 'idle' | 'connecting' | 'speaking' | 'error'

/** How long after the last sign of audio we keep showing "speaking". */
export const SPEAKING_WINDOW_MS = 1200
/** Mic peak (0..1) above which we treat the mic as actively speaking. */
export const MIC_PEAK_THRESHOLD = 0.04

export interface ChannelHealthInput {
  /** STT connection status for the channel, or null if not started. */
  status: TranscriptionStatus | null
  /** Wall-clock ms of the last segment (partial or final) on this channel. */
  lastActivityAt: number | null
  /** Latest mic peak (0..1). Only meaningful for the mic channel. */
  micPeak?: number
  /** `Date.now()` — injected so the derivation stays pure/testable. */
  now: number
}

/**
 * Derive a single channel's discrete state. Error wins over everything (the
 * user must know capture is broken). Otherwise "speaking" is driven by recent
 * recognized text — which the overlay actually receives over IPC — and, for the
 * mic, by a live peak above threshold as a faster signal before any text lands.
 */
export function deriveChannelState(channel: AudioChannel, input: ChannelHealthInput): CaptureState {
  const { status, lastActivityAt, micPeak, now } = input
  if (status?.kind === 'error') return 'error'
  if (status?.kind === 'connecting') return 'connecting'

  const recentText = lastActivityAt != null && now - lastActivityAt <= SPEAKING_WINDOW_MS
  const loudMic = channel === 'mic' && (micPeak ?? 0) >= MIC_PEAK_THRESHOLD
  if (recentText || loudMic) return 'speaking'

  return 'idle'
}
