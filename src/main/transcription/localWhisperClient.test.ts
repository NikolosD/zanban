import { describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'

const model = vi.hoisted(() => ({
  loads: 0,
  disposes: 0,
  ready: Promise.resolve()
}))

vi.mock('electron', () => ({ app: { getPath: () => 'userData' } }))
vi.mock('@xenova/transformers', () => ({
  env: {},
  pipeline: async () => {
    model.loads += 1
    await model.ready
    return Object.assign(async () => ({ text: 'last words' }), {
      dispose: async () => {
        model.disposes += 1
      }
    })
  }
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<unknown>) => fn()
}))

const { LocalWhisperSttChannel } = await import('./localWhisperClient.js')

function openChannel(): {
  ch: InstanceType<typeof LocalWhisperSttChannel>
  segments: TranscriptSegment[]
  statuses: TranscriptionStatus[]
} {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new LocalWhisperSttChannel({
    language: 'en',
    channel: 'mic',
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s)
  })
  return { ch, segments, statuses }
}

describe('LocalWhisperSttChannel', () => {
  it('transcribes the buffered tail on close instead of dropping it', async () => {
    const { ch, segments, statuses } = openChannel()
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('open'))

    ch.send(new Int16Array(16_000).fill(1000).buffer)
    ch.close()

    await vi.waitFor(() => expect(segments).toHaveLength(1))
    expect(segments[0]).toMatchObject({
      text: 'last words',
      isFinal: true,
      startMs: 0,
      endMs: 1000
    })
  })

  it('transcribes audio that arrived while the model was loading', async () => {
    let finishLoad = (): void => {}
    model.ready = new Promise((resolve) => (finishLoad = resolve))
    const { ch, segments, statuses } = openChannel()

    ch.send(new Int16Array(16_000 * 6).fill(1000).buffer)
    expect(statuses.at(-1)?.kind).toBe('connecting')
    finishLoad()

    await vi.waitFor(() => expect(segments).toHaveLength(1))
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 5000 })
    ch.close()
    await vi.waitFor(() => expect(segments).toHaveLength(2))
    expect(segments[1]).toMatchObject({ startMs: 5000, endMs: 6000 })
  })

  it('releases the model once every channel has closed and reloads it for the next call', async () => {
    model.ready = Promise.resolve()
    await vi.waitFor(() => expect(model.disposes).toBe(model.loads))
    const loadsBefore = model.loads

    const mic = openChannel()
    const system = openChannel()
    await vi.waitFor(() => expect(system.statuses.at(-1)?.kind).toBe('open'))
    expect(model.loads).toBe(loadsBefore + 1)

    mic.ch.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(model.disposes).toBe(loadsBefore)
    system.ch.close()
    await vi.waitFor(() => expect(model.disposes).toBe(loadsBefore + 1))

    const next = openChannel()
    await vi.waitFor(() => expect(next.statuses.at(-1)?.kind).toBe('open'))
    expect(model.loads).toBe(loadsBefore + 2)
    next.ch.close()
  })
})
