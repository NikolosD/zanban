import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdleResource } from './idleResource.js'

interface Fake {
  id: number
}

function setup(idleMs = 1000): {
  resource: IdleResource<Fake>
  loads: () => number
  disposed: Fake[]
} {
  let loads = 0
  const disposed: Fake[] = []
  const resource = new IdleResource<Fake>({
    load: async () => ({ id: ++loads }),
    dispose: async (r) => {
      disposed.push(r)
    },
    idleMs
  })
  return { resource, loads: () => loads, disposed }
}

describe('IdleResource', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads once for concurrent users', async () => {
    const { resource, loads } = setup()
    const [a, b] = await Promise.all([resource.acquire(), resource.acquire()])
    expect(a).toBe(b)
    expect(loads()).toBe(1)
  })

  it('disposes only after the idle period with no holders, then reloads on demand', async () => {
    const { resource, loads, disposed } = setup()
    const first = await resource.use(async (r) => r)

    await vi.advanceTimersByTimeAsync(999)
    expect(disposed).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(disposed).toEqual([first])

    const second = await resource.use(async (r) => r)
    expect(second).not.toBe(first)
    expect(loads()).toBe(2)
  })

  it('never disposes while held, and a new use cancels a pending dispose', async () => {
    const { resource, disposed } = setup()
    const held = await resource.acquire()
    await vi.advanceTimersByTimeAsync(5000)
    expect(disposed).toHaveLength(0)

    resource.release()
    await vi.advanceTimersByTimeAsync(500)
    await resource.use(async () => {})
    await vi.advanceTimersByTimeAsync(999)
    expect(disposed).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(disposed).toEqual([held])
  })

  it('disposes on the last release when idleMs is 0', async () => {
    const { resource, disposed } = setup(0)
    const r = await resource.acquire()
    await resource.acquire()
    resource.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toHaveLength(0)
    resource.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toEqual([r])
  })

  it('retries a failed load on the next acquire', async () => {
    let attempts = 0
    const resource = new IdleResource<Fake>({
      load: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('offline')
        return { id: attempts }
      },
      dispose: async () => {},
      idleMs: 1000
    })
    await expect(resource.acquire()).rejects.toThrow('offline')
    await expect(resource.acquire()).resolves.toEqual({ id: 2 })
  })
})
