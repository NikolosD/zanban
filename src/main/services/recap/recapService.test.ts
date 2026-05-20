import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRecapService } from './recapService.js'
import type { SessionDetailPayload } from '../../../shared/api.js'
import type { RecapResult } from './recapSchema.js'

const session: SessionDetailPayload = {
  id: 'sess1',
  startedAt: 0,
  endedAt: 1000,
  title: 'Test',
  segments: [
    { channel: 'mic', startMs: 0, text: 'hi' },
    { channel: 'system', startMs: 100, text: 'hello' }
  ],
  exchanges: [],
  filePath: '/tmp/sess1.json'
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zanban-recap-svc-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function okResult(): Extract<RecapResult, { ok: true }> {
  return {
    ok: true,
    recap: {
      schemaVersion: 1,
      tldr: 'they said hi',
      decisions: [],
      actionItems: [],
      openQuestions: [],
      followUp: null,
      generatedAt: 1,
      model: 'mock',
      promptVersion: 1
    }
  }
}

describe('recapService', () => {
  it('generates, persists, and emits update', async () => {
    const onUpdate = vi.fn()
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: onUpdate
    })
    const result = await svc.generate('sess1', {})
    expect(result.ok).toBe(true)
    expect(onUpdate).toHaveBeenCalledWith('sess1')
    const got = await svc.get('sess1')
    expect(got?.tldr).toBe('they said hi')
  })

  it('rejects concurrent generate for same id', async () => {
    let resolveLlm: (v: RecapResult) => void
    const llmPromise = new Promise<RecapResult>((r) => (resolveLlm = r))
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => llmPromise,
      onUpdated: () => undefined
    })
    const first = svc.generate('sess1', {})
    const second = await svc.generate('sess1', {})
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('already_generating')
    resolveLlm!(okResult())
    await first
  })

  it('returns no_transcript when session is missing', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => null,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    const result = await svc.generate('missing', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_transcript')
  })

  it('persists a partial result with partial:true', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => ({
        ok: false,
        code: 'invalid_output',
        message: 'partial',
        partial: { ...okResult().recap, partial: true }
      }),
      onUpdated: () => undefined
    })
    const result = await svc.generate('sess1', {})
    expect(result.ok).toBe(false)
    const got = await svc.get('sess1')
    expect(got?.partial).toBe(true)
  })

  it('delete removes the sidecar', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    await svc.generate('sess1', {})
    await svc.delete('sess1')
    expect(await svc.get('sess1')).toBeNull()
  })
})
