import { describe, expect, it, vi } from 'vitest'
import { createAutoTrigger } from './recapAutoTrigger.js'

describe('recapAutoTrigger', () => {
  it('does nothing when autoGenerate is off', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true })
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: false } }) as never,
      generate,
      trackJob: async (_id, _t, _k, fn) => fn()
    })
    await trigger.onSessionStopped('sess1')
    expect(generate).not.toHaveBeenCalled()
  })

  it('invokes generate through trackJob when autoGenerate is on', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true })
    const trackJob = vi.fn(async (_id, _t, _k, fn) => fn())
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: true } }) as never,
      generate,
      trackJob
    })
    await trigger.onSessionStopped('sess1')
    expect(trackJob).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith('sess1', {})
  })

  it('swallows generate errors so session-stop is not blocked', async () => {
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: true } }) as never,
      generate: () => Promise.reject(new Error('boom')),
      trackJob: async (_id, _t, _k, fn) => fn()
    })
    await expect(trigger.onSessionStopped('sess1')).resolves.toBeUndefined()
  })

  it('awaits awaitFinalized before calling trackJob when provided', async () => {
    const order: string[] = []
    let resolveFinalized!: () => void
    const finalizedPromise = new Promise<void>((resolve) => {
      resolveFinalized = resolve
    })
    const awaitFinalized = vi.fn((_id: string) => {
      order.push('awaitFinalized')
      return finalizedPromise
    })
    const trackJob = vi.fn(
      async (_id: string, _t: string, _k: string, fn: () => Promise<unknown>) => {
        order.push('trackJob')
        return fn()
      }
    )
    const generate = vi.fn().mockResolvedValue({ ok: true })
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: true } }) as never,
      generate,
      trackJob,
      awaitFinalized
    })
    const stopped = trigger.onSessionStopped('sess2')
    // trackJob must not have been called yet — still waiting on finalized
    expect(order).toEqual(['awaitFinalized'])
    expect(trackJob).not.toHaveBeenCalled()
    // Now resolve finalize and let the trigger proceed
    resolveFinalized()
    await stopped
    expect(order).toEqual(['awaitFinalized', 'trackJob'])
    expect(trackJob).toHaveBeenCalledTimes(1)
  })
})
