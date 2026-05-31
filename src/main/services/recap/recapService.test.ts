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

  it('never overwrites a complete recap with a partial one', async () => {
    // First generate a complete recap.
    const completeSvc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    await completeSvc.generate('sess1', {})
    expect((await completeSvc.get('sess1'))?.partial).toBeUndefined()

    // Now a flaky regeneration yields only a partial — it must NOT clobber.
    const onUpdate = vi.fn()
    const partialSvc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => ({
        ok: false,
        code: 'invalid_output',
        message: 'partial',
        partial: { ...okResult().recap, tldr: 'incomplete', partial: true }
      }),
      onUpdated: onUpdate
    })
    const result = await partialSvc.generate('sess1', {})
    expect(result.ok).toBe(false)
    const got = await partialSvc.get('sess1')
    expect(got?.partial).toBeUndefined()
    expect(got?.tldr).toBe('they said hi') // original complete recap preserved
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('listMyActionItems aggregates only owner:you items across sessions, newest first', async () => {
    const sessions: Record<string, SessionDetailPayload> = {
      old: { ...session, id: 'old', startedAt: 1000, title: 'Old call' },
      new: { ...session, id: 'new', startedAt: 5000, title: 'New call' }
    }
    const svc = createRecapService({
      dir,
      readSession: async (id) => sessions[id] ?? null,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    // Seed two recaps with a mix of owners.
    const withItems = (
      items: Array<{ text: string; owner: 'you' | 'them' | 'unknown'; dueHint?: string }>
    ): RecapResult => ({
      ok: true,
      recap: { ...okResult().recap, actionItems: items }
    })
    const svcOld = createRecapService({
      dir,
      readSession: async (id) => sessions[id] ?? null,
      llm: async () =>
        withItems([
          { text: 'old you task', owner: 'you' },
          { text: 'their task', owner: 'them' }
        ]),
      onUpdated: () => undefined
    })
    const svcNew = createRecapService({
      dir,
      readSession: async (id) => sessions[id] ?? null,
      llm: async () => withItems([{ text: 'new you task', owner: 'you', dueHint: 'Fri' }]),
      onUpdated: () => undefined
    })
    await svcOld.generate('old', {})
    await svcNew.generate('new', {})

    const items = await svc.listMyActionItems()
    expect(items.map((i) => i.text)).toEqual(['new you task', 'old you task'])
    expect(items[0]).toMatchObject({
      sessionId: 'new',
      sessionTitle: 'New call',
      dueHint: 'Fri'
    })
    // "them"-owned items are excluded entirely.
    expect(items.some((i) => i.text === 'their task')).toBe(false)
  })

  it('a complete recap overwrites an existing partial one', async () => {
    const partialSvc = createRecapService({
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
    await partialSvc.generate('sess1', {})
    expect((await partialSvc.get('sess1'))?.partial).toBe(true)

    const completeSvc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    await completeSvc.generate('sess1', {})
    expect((await completeSvc.get('sess1'))?.partial).toBeUndefined()
  })
})
