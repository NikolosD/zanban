import { describe, expect, it } from 'vitest'
import { errorMessage, pointsToSettings } from './errors'

describe('errorMessage', () => {
  it('strips the Electron remote-method wrapper and the inner Error prefix', () => {
    const err = new Error(
      "Error invoking remote method 'session:start': Error: Deepgram API key not set. Open Settings."
    )
    expect(errorMessage(err)).toBe('Deepgram API key not set. Open Settings.')
  })

  it('strips a bare leading Error prefix', () => {
    expect(errorMessage(new Error('Error: boom'))).toBe('boom')
  })

  it('keeps plain messages and stringifies non-Error values', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full')
    expect(errorMessage('nope')).toBe('nope')
  })

  it('leaves other error type prefixes alone', () => {
    expect(errorMessage(new Error("Error invoking remote method 'x': TypeError: bad"))).toBe(
      'TypeError: bad'
    )
  })
})

describe('pointsToSettings', () => {
  it('matches main credential guard messages', () => {
    expect(pointsToSettings('Deepgram API key not set. Open Settings.')).toBe(true)
    expect(pointsToSettings('Vercel AI Gateway key not configured. Open Settings.')).toBe(true)
  })

  it('ignores unrelated failures', () => {
    expect(pointsToSettings('Permission denied')).toBe(false)
  })
})
