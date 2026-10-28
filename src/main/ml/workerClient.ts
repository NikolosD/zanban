import type { MlRequest, MlResponse, MlResults, MlTask } from './protocol.js'

/** The part of Electron's UtilityProcess the client drives. */
export interface MlWorkerProcess {
  postMessage(message: MlRequest): void
  kill(): boolean
  on(event: 'message', listener: (message: MlResponse) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
}

export interface MlWorkerClientOptions {
  fork: () => MlWorkerProcess
  /** The worker is killed after this long with nothing in flight, freeing its models. */
  idleMs: number
  /** Delay before each respawn after consecutive crashes; the last one repeats. */
  restartDelaysMs: number[]
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  onProgress?: (fraction: number) => void
  timer: ReturnType<typeof setTimeout>
}

// A worker that stayed up this long before crashing was healthy; restart the backoff.
const STABLE_UPTIME_MS = 60_000

/**
 * Main-process handle on the ML utility process. The worker is spawned on the
 * first request and killed once idle. A crash rejects everything in flight; the
 * next request respawns it, no sooner than the backoff allows.
 */
export class MlWorkerClient {
  private child: MlWorkerProcess | null = null
  private spawnedAt = 0
  private readonly pending = new Map<number, Pending>()
  private queued: MlRequest[] = []
  private nextId = 1
  private crashes = 0
  private respawnAt = 0
  private spawnTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private isShutDown = false

  constructor(private readonly opts: MlWorkerClientOptions) {}

  request<T extends MlTask>(
    task: T,
    timeoutMs: number,
    onProgress?: (fraction: number) => void
  ): Promise<MlResults[T['kind']]> {
    if (this.isShutDown) return Promise.reject(new Error('ML worker is shut down'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id)?.reject(new Error(`ML ${task.kind} timed out after ${timeoutMs} ms`)),
        timeoutMs
      )
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        onProgress,
        timer
      })
      this.clearIdleTimer()
      this.send({ ...task, id })
    })
  }

  /** Rejects everything in flight and kills the worker for good, for app quit. */
  shutdown(): void {
    this.isShutDown = true
    if (this.spawnTimer) clearTimeout(this.spawnTimer)
    this.spawnTimer = null
    this.queued = []
    this.rejectAll(new Error('ML worker shut down'))
    this.clearIdleTimer()
    this.kill()
  }

  private send(request: MlRequest): void {
    if (this.child) {
      this.child.postMessage(request)
      return
    }
    this.queued.push(request)
    if (this.spawnTimer) return
    const delay = this.respawnAt - Date.now()
    if (delay <= 0) this.spawn()
    else this.spawnTimer = setTimeout(() => this.spawn(), delay)
  }

  private spawn(): void {
    this.spawnTimer = null
    const queued = this.queued.filter((request) => this.pending.has(request.id))
    this.queued = []
    if (queued.length === 0) return

    const child = this.opts.fork()
    this.child = child
    this.spawnedAt = Date.now()
    child.on('message', (response) => this.onResponse(response))
    child.on('exit', (code) => this.onExit(child, code))
    for (const request of queued) child.postMessage(request)
  }

  private onResponse(response: MlResponse): void {
    if ('progress' in response) {
      this.pending.get(response.id)?.onProgress?.(response.progress)
      return
    }
    const entry = this.settle(response.id)
    if (!entry) return
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(response.error))
  }

  private onExit(child: MlWorkerProcess, code: number): void {
    // Workers killed on purpose were detached first.
    if (child !== this.child) return
    this.child = null
    this.clearIdleTimer()
    const now = Date.now()
    if (now - this.spawnedAt >= STABLE_UPTIME_MS) this.crashes = 0
    const delays = this.opts.restartDelaysMs
    this.respawnAt = now + (delays[Math.min(this.crashes, delays.length - 1)] ?? 0)
    this.crashes += 1
    console.error(`[ml-worker] exited unexpectedly (code ${code})`)
    this.rejectAll(new Error(`ML worker exited unexpectedly (code ${code})`))
  }

  private settle(id: number): Pending | undefined {
    const entry = this.pending.get(id)
    if (!entry) return undefined
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (this.pending.size === 0) this.armIdleTimer()
    return entry
  }

  private rejectAll(err: Error): void {
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(err)
  }

  private armIdleTimer(): void {
    this.clearIdleTimer()
    if (!this.child) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.crashes = 0
      this.kill()
    }, this.opts.idleMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private kill(): void {
    const child = this.child
    this.child = null
    child?.kill()
  }
}
