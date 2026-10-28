import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { MlTask, SpeechSegment } from '../ml/protocol.js'

const worker = vi.hoisted(() => ({
  ready: Promise.resolve() as Promise<void>,
  failLoad: false,
  requests: [] as Array<{ kind: string; samples?: number }>,
  replies: [] as SpeechSegment[][]
}))

vi.mock('../ml/index.js', () => ({
  speechWorker: {
    request: async (task: MlTask) => {
      if (task.kind === 'load') {
        await worker.ready
        if (worker.failLoad) throw new Error('download failed')
        return undefined
      }
      if (task.kind === 'speechFeed') {
        worker.requests.push({ kind: task.kind, samples: task.samples.length })
      } else if (task.kind === 'speechEnd') {
        worker.requests.push({ kind: task.kind })
      } else {
        throw new Error(`unexpected ${task.kind}`)
      }
      return worker.replies.shift() ?? []
    }
  }
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<unknown>) => fn()
}))

const { LocalParakeetSttChannel } = await import('./localParakeetClient.js')

function openChannel(): {
  ch: InstanceType<typeof LocalParakeetSttChannel>
  segments: TranscriptSegment[]
  statuses: TranscriptionStatus[]
} {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new LocalParakeetSttChannel({
    channel: 'system',
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s)
  })
  return { ch, segments, statuses }
}

const pcm = (seconds: number): ArrayBuffer => new Int16Array(16_000 * seconds).fill(1000).buffer

describe('LocalParakeetSttChannel', () => {
  beforeEach(() => {
    worker.ready = Promise.resolve()
    worker.failLoad = false
    worker.requests = []
    worker.replies = []
  })

  it('streams audio and emits each phrase the worker returns as a final segment', async () => {
    const { ch, segments, statuses } = openChannel()
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('open'))

    worker.replies = [[{ text: 'Добрый день', startMs: 200, endMs: 1400 }]]
    ch.send(pcm(1))

    await vi.waitFor(() => expect(segments).toHaveLength(1))
    expect(segments[0]).toMatchObject({
      text: 'Добрый день',
      channel: 'system',
      speaker: 1,
      startMs: 200,
      endMs: 1400,
      isFinal: true
    })
  })

  it('sends audio captured during the model load first, minus what overflowed', async () => {
    let finishLoad = (): void => {}
    worker.ready = new Promise((resolve) => (finishLoad = resolve))
    const { ch, segments, statuses } = openChannel()

    ch.send(pcm(31))
    expect(statuses.at(-1)?.kind).toBe('connecting')
    worker.replies = [[{ text: 'kept', startMs: 0, endMs: 500 }]]
    finishLoad()
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('open'))
    ch.send(pcm(1))

    await vi.waitFor(() => expect(worker.requests).toHaveLength(2))
    expect(worker.requests).toEqual([
      { kind: 'speechFeed', samples: 16_000 * 30 },
      { kind: 'speechFeed', samples: 16_000 }
    ])
    // The first second was dropped, so the worker's clock starts one second in.
    expect(segments[0]).toMatchObject({ text: 'kept', startMs: 1000, endMs: 1500 })
  })

  it('ends the stream on close so the last phrase is not lost', async () => {
    const { ch, segments, statuses } = openChannel()
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('open'))

    ch.send(pcm(1))
    worker.replies = [[], [{ text: 'last words', startMs: 0, endMs: 900 }]]
    ch.close()

    await vi.waitFor(() => expect(segments).toHaveLength(1))
    expect(worker.requests.map((r) => r.kind)).toEqual(['speechFeed', 'speechEnd'])
    expect(segments[0]?.text).toBe('last words')
    expect(statuses.at(-1)?.kind).toBe('closed')
  })

  it('reports a failed model load and stops sending audio', async () => {
    worker.failLoad = true
    const { ch, statuses } = openChannel()

    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('error'))
    ch.send(pcm(1))
    ch.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(worker.requests).toEqual([])
  })
})
