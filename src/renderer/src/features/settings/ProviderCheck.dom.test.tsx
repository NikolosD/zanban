// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ProviderTestResult } from '@shared/api'
import { useProviderCheck } from './ProviderCheck'

function mockProbes() {
  const pending: Array<{
    resolve: (result: ProviderTestResult) => void
    reject: (err: Error) => void
  }> = []
  const testConnection = vi.fn(
    () =>
      new Promise<ProviderTestResult>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
  )
  vi.stubGlobal('zanban', { providers: { testConnection } })
  return pending
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useProviderCheck', () => {
  it('reports the result of a single check', async () => {
    const probes = mockProbes()
    const { result } = renderHook(() => useProviderCheck('openai'))
    expect(result.current.testing).toBe(false)

    act(() => void result.current.check())
    expect(result.current.testing).toBe(true)

    await act(async () => probes[0]!.resolve({ ok: true }))
    expect(result.current).toMatchObject({ testing: false, result: { ok: true } })
  })

  it('turns a thrown error into a failed result', async () => {
    const probes = mockProbes()
    const { result } = renderHook(() => useProviderCheck('openai'))
    act(() => void result.current.check())

    await act(async () => probes[0]!.reject(new Error('socket hang up')))
    expect(result.current.result).toEqual({ ok: false, message: 'socket hang up' })
  })

  it('does not let an older check overwrite a newer one that landed first', async () => {
    const probes = mockProbes()
    const { result } = renderHook(() => useProviderCheck('openai'))
    act(() => void result.current.check())
    act(() => void result.current.check())

    await act(async () => probes[1]!.resolve({ ok: true }))
    await act(async () => probes[0]!.reject(new Error('socket hang up')))
    expect(result.current).toMatchObject({ testing: false, result: { ok: true } })
  })

  it('stays busy until the newest check lands, whatever an older one says', async () => {
    const probes = mockProbes()
    const { result } = renderHook(() => useProviderCheck('openai'))
    act(() => void result.current.check())
    act(() => void result.current.check())

    await act(async () => probes[0]!.resolve({ ok: false, message: 'late' }))
    expect(result.current).toMatchObject({ testing: true, result: null })

    await act(async () => probes[1]!.resolve({ ok: true }))
    expect(result.current).toMatchObject({ testing: false, result: { ok: true } })
  })
})
