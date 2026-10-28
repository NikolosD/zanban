import { create } from 'zustand'
import type { CaptureNoticeKind } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'

export interface CaptureNoticeFlags {
  micLost: boolean
  micHealed: boolean
  micSilent: boolean
  systemUnavailable: boolean
}

export const NO_NOTICES: CaptureNoticeFlags = {
  micLost: false,
  micHealed: false,
  micSilent: false,
  systemUnavailable: false
}

export const HEALED_VISIBLE_MS = 4000

export function applyNotice(
  flags: CaptureNoticeFlags,
  kind: CaptureNoticeKind
): CaptureNoticeFlags {
  switch (kind) {
    case 'mic-lost':
      return { ...flags, micLost: true, micHealed: false, micSilent: false }
    case 'mic-healed':
      return { ...flags, micLost: false, micHealed: true, micSilent: false }
    case 'mic-silent':
      return { ...flags, micSilent: true }
    case 'system-unavailable':
      return { ...flags, systemUnavailable: true }
  }
}

/**
 * The single notice the overlay shows. A lost mic outranks everything because
 * the user's own words stop reaching the transcript; the brief "mic back"
 * confirmation outranks the standing warnings so it isn't hidden behind them.
 */
export function visibleNotice(flags: CaptureNoticeFlags): CaptureNoticeKind | null {
  if (flags.micLost) return 'mic-lost'
  if (flags.micHealed) return 'mic-healed'
  if (flags.systemUnavailable) return 'system-unavailable'
  if (flags.micSilent) return 'mic-silent'
  return null
}

interface CaptureNoticesState {
  flags: CaptureNoticeFlags
}

export const useCaptureNotices = create<CaptureNoticesState>(() => ({ flags: NO_NOTICES }))

function update(fn: (flags: CaptureNoticeFlags) => CaptureNoticeFlags): void {
  useCaptureNotices.setState((s) => ({ flags: fn(s.flags) }))
}

/**
 * Collect the capture notices main relays from the capture window. There is no
 * "recovered" notice for a silent mic or missing system audio, so the flags
 * reset when the session ends, and "mic silent" clears as soon as mic speech is
 * transcribed again.
 */
export function wireCaptureNotices(): () => void {
  let healedTimer: ReturnType<typeof setTimeout> | null = null
  const offNotice = window.zanban.audio.onNotice(({ kind }) => {
    update((flags) => applyNotice(flags, kind))
    if (kind !== 'mic-healed') return
    if (healedTimer) clearTimeout(healedTimer)
    healedTimer = setTimeout(
      () => update((flags) => ({ ...flags, micHealed: false })),
      HEALED_VISIBLE_MS
    )
  })
  const offTranscript = useTranscript.subscribe((s, prev) => {
    if (prev.session.kind === 'running' && s.session.kind !== 'running') {
      useCaptureNotices.setState({ flags: NO_NOTICES })
      return
    }
    const micHeard =
      (s.partials.mic !== null && s.partials.mic !== prev.partials.mic) ||
      (s.finals !== prev.finals && s.finals.at(-1)?.channel === 'mic')
    if (micHeard && useCaptureNotices.getState().flags.micSilent) {
      update((flags) => ({ ...flags, micSilent: false }))
    }
  })
  return () => {
    offNotice()
    offTranscript()
    if (healedTimer) clearTimeout(healedTimer)
  }
}
