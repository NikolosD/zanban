export const STALL_TIMEOUT_MS = 20_000
const CHECK_INTERVAL_MS = 5_000

/**
 * Detects a streaming STT socket that still accepts audio but no longer
 * answers. A half-open TCP connection (laptop sleep, Wi-Fi switch, NAT drop)
 * never fires `close`, so without this the channel sits "open" and silently
 * transcribes nothing for the rest of the call.
 *
 * `probe` runs on every check (e.g. a WebSocket ping) and counts as traffic
 * that needs an answer — it lets quiet stretches, where the server has nothing
 * to say, still prove the socket is alive.
 */
export class LivenessWatchdog {
  private unansweredSince: number | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onStall: () => void,
    private readonly probe?: () => void
  ) {}

  start(): void {
    this.stop()
    this.unansweredSince = null
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  noteSent(): void {
    this.unansweredSince ??= Date.now()
  }

  noteHeard(): void {
    this.unansweredSince = null
  }

  private check(): void {
    if (this.unansweredSince !== null && Date.now() - this.unansweredSince >= STALL_TIMEOUT_MS) {
      this.stop()
      this.onStall()
      return
    }
    if (this.probe) {
      this.probe()
      this.noteSent()
    }
  }
}
