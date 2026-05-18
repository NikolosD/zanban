import type { AudioChannel, TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'

export interface StubSttOptions {
  channel: AudioChannel
  providerLabel: string
  onSegment: (seg: TranscriptSegment) => void
  onStatus: (status: TranscriptionStatus) => void
}

/**
 * Fallback STT channel for an unrecognized provider id. It announces an
 * explicit error status the moment a session starts so the user immediately
 * sees that the provider isn't usable, instead of staring at an empty
 * transcript.
 */
export class StubSttChannel {
  constructor(private readonly opts: StubSttOptions) {
    this.opts.onStatus({
      kind: 'error',
      channel: opts.channel,
      message: `${opts.providerLabel} streaming STT is scaffolded but not wired up yet. Switch back to Deepgram in Providers, or open an issue.`
    })
  }
  send(_buffer: ArrayBuffer): void {
    // Drop on the floor — no provider attached.
  }
  close(): void {
    this.opts.onStatus({ kind: 'closed', channel: this.opts.channel })
  }
}
