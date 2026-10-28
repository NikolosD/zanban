import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'
import type { MlTask } from '../ml/protocol.js'

const worker = vi.hoisted(() => ({
  ready: Promise.resolve() as Promise<void>,
  failLoad: false,
  batches: [] as Array<{ samples: number; language?: string }>
}))

vi.mock('../ml/index.js', () => ({
  mlWorker: {
    request: async (task: MlTask) => {
      if (task.kind === 'load') {
        await worker.ready
        if (worker.failLoad) throw new Error('onnxruntime missing')
        return undefined
      }
      if (task.kind !== 'transcribe') throw new Error(`unexpected ${task.kind}`)
      worker.batches.push({ samples: task.samples.length, language: task.language })
      return 'last words'
    }
  }
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<unknown>) => fn()
}))

const { LocalWhisperSttChannel } = await import('./localWhisperClient.js')

function openChannel(language = 'en'): {
  ch: InstanceType<typeof LocalWhisperSttChannel>
  segments: TranscriptSegment[]
  statuses: TranscriptionStatus[]
} {
  const segments: TranscriptSegment[] = []
  const statuses: TranscriptionStatus[] = []
  const ch = new LocalWhisperSttChannel({
    language,
    channel: 'mic',
    onSegment: (s) => segments.push(s),
    onStatus: (s) => statuses.push(s)
  })
  return { ch, segments, statuses }
}

describe('LocalWhisperSttChannel', () => {
  beforeEach(() => {
    worker.ready = Promise.resolve()
    worker.failLoad = false
    worker.batches = []
  })

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
    expect(worker.batches).toEqual([{ samples: 16_000, language: 'en' }])
  })

  it('transcribes audio that arrived while the model was loading', async () => {
    let finishLoad = (): void => {}
    worker.ready = new Promise((resolve) => (finishLoad = resolve))
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

  it('lets Whisper detect the language for multi-language calls', async () => {
    const { ch, segments, statuses } = openChannel('multi')
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('open'))
    ch.send(new Int16Array(16_000 * 5).buffer)
    await vi.waitFor(() => expect(segments).toHaveLength(1))
    expect(worker.batches).toEqual([{ samples: 80_000, language: undefined }])
    ch.close()
  })

  it('reports a failed model load and drops audio instead of queueing it', async () => {
    worker.failLoad = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ch, segments, statuses } = openChannel()
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe('error'))

    ch.send(new Int16Array(16_000 * 6).buffer)
    ch.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(segments).toEqual([])
    expect(worker.batches).toEqual([])
    error.mockRestore()
  })
})
