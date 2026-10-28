interface IdleResourceOptions<T> {
  load: () => Promise<T>
  dispose: (resource: T) => Promise<unknown>
  /** How long the resource may sit unused before it is disposed; 0 disposes on last release. */
  idleMs: number
}

/**
 * A lazily loaded resource (a model, a worker) that is disposed once nobody has
 * held it for `idleMs` and reloaded on the next use. It is never disposed while
 * held, and a reload started during a dispose gets a fresh instance.
 */
export class IdleResource<T> {
  private loading: Promise<T> | null = null
  private users = 0
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: IdleResourceOptions<T>) {}

  /** Every successful acquire() must be paired with one release(). */
  async acquire(): Promise<T> {
    this.users += 1
    this.clearIdleTimer()
    const loading = (this.loading ??= this.opts.load())
    try {
      return await loading
    } catch (err) {
      // A failed load must not stick; the next acquire retries it.
      if (this.loading === loading) this.loading = null
      this.users -= 1
      throw err
    }
  }

  release(): void {
    this.users -= 1
    if (this.users > 0 || !this.loading) return
    if (this.opts.idleMs <= 0) {
      void this.disposeIdle()
      return
    }
    this.idleTimer = setTimeout(() => void this.disposeIdle(), this.opts.idleMs)
  }

  async use<R>(fn: (resource: T) => Promise<R>): Promise<R> {
    const resource = await this.acquire()
    try {
      return await fn(resource)
    } finally {
      this.release()
    }
  }

  /** Disposes the resource even if it is held, for app shutdown. */
  async close(): Promise<void> {
    this.clearIdleTimer()
    const loading = this.loading
    this.loading = null
    const resource = await loading?.catch(() => null)
    if (resource) await this.opts.dispose(resource)
  }

  private async disposeIdle(): Promise<void> {
    this.idleTimer = null
    if (this.users > 0) return
    await this.close().catch((err: unknown) => console.warn('[idle-resource] dispose failed', err))
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
