import { describe, it, expect } from 'vitest'
import { raceTimeout } from './raceTimeout'

describe('raceTimeout', () => {
  it('resolves with the promise value when it wins', async () => {
    const out = await raceTimeout(Promise.resolve('ok'), 50, 'fallback')
    expect(out).toBe('ok')
  })

  it('resolves with the fallback when the promise is too slow', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('late'), 500))
    const out = await raceTimeout(slow, 50, 'fallback')
    expect(out).toBe('fallback')
  })

  it('resolves with the fallback when the promise rejects', async () => {
    const out = await raceTimeout(Promise.reject(new Error('boom')), 50, 'fallback')
    expect(out).toBe('fallback')
  })
})
