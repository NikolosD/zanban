import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MlRequest, MlResponse } from './protocol.js'
import { MlWorkerClient } from './workerClient.js'

class FakeWorker extends EventEmitter {
  readonly received: MlRequest[] = []
  killed = false

  postMessage(message: MlRequest): void {
    this.received.push(message)
  }

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }

  reply(response: MlResponse): void {
    this.emit('message', response)
  }

  crash(code = 1): void {
    this.emit('exit', code)
  }
}

const IDLE_MS = 5 * 60_000

function setup(): { client: MlWorkerClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = []
  const client = new MlWorkerClient({
    fork: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    idleMs: IDLE_MS,
    restartDelaysMs: [1000, 5000]
  })
  return { client, workers }
}

describe('MlWorkerClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('spawns on first use and matches out-of-order responses to their requests', async () => {
    const { client, workers } = setup()
    expect(workers).toHaveLength(0)

    const embed = client.request({ kind: 'embed', texts: ['a'] }, 1000)
    const extract = client.request(
      { kind: 'extract', format: 'pdf', data: new Uint8Array(1) },
      1000
    )
    expect(workers).toHaveLength(1)
    const [worker] = workers
    const [embedReq, extractReq] = worker!.received
    expect(embedReq).toMatchObject({ kind: 'embed', texts: ['a'] })

    worker!.reply({ id: extractReq!.id, ok: true, result: 'doc text' })
    worker!.reply({ id: embedReq!.id, ok: true, result: [new Float32Array([1, 2])] })
    await expect(extract).resolves.toBe('doc text')
    await expect(embed).resolves.toEqual([new Float32Array([1, 2])])
    expect(workers).toHaveLength(1)
  })

  it('rejects with the error the worker reports', async () => {
    const { client, workers } = setup()
    const load = client.request({ kind: 'load', model: 'embedder' }, 1000)
    const [request] = workers[0]!.received
    workers[0]!.reply({ id: request!.id, ok: false, error: 'offline' })
    await expect(load).rejects.toThrow('offline')
  })

  it('times out a request without disturbing the others, ignoring its late reply', async () => {
    const { client, workers } = setup()
    const slow = client.request({ kind: 'embed', texts: ['slow'] }, 1000)
    const other = client.request({ kind: 'embed', texts: ['other'] }, 10_000)
    const slowAssertion = expect(slow).rejects.toThrow('ML embed timed out after 1000 ms')

    await vi.advanceTimersByTimeAsync(1000)
    await slowAssertion
    const [slowReq, otherReq] = workers[0]!.received
    workers[0]!.reply({ id: slowReq!.id, ok: true, result: [] })
    workers[0]!.reply({ id: otherReq!.id, ok: true, result: [] })
    await expect(other).resolves.toEqual([])
  })

  it('rejects in-flight requests on a crash and respawns after the backoff', async () => {
    const { client, workers } = setup()
    const a = client.request({ kind: 'load', model: 'whisper' }, 60_000)
    const b = client.request({ kind: 'embed', texts: ['x'] }, 60_000)
    workers[0]!.crash(3)
    await expect(a).rejects.toThrow('ML worker exited unexpectedly (code 3)')
    await expect(b).rejects.toThrow('code 3')

    const retry = client.request({ kind: 'load', model: 'whisper' }, 60_000)
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(workers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(workers).toHaveLength(2)

    const [request] = workers[1]!.received
    workers[1]!.reply({ id: request!.id, ok: true, result: undefined })
    await expect(retry).resolves.toBeUndefined()

    workers[1]!.crash()
    const again = client.request({ kind: 'load', model: 'whisper' }, 60_000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(workers).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(workers).toHaveLength(3)
    workers[2]!.reply({ id: workers[2]!.received[0]!.id, ok: true, result: undefined })
    await again
  })

  it('kills the worker once idle and spawns a fresh one on the next request', async () => {
    const { client, workers } = setup()
    const first = client.request({ kind: 'load', model: 'embedder' }, 1000)
    workers[0]!.reply({ id: workers[0]!.received[0]!.id, ok: true, result: undefined })
    await first

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    const busy = client.request({ kind: 'embed', texts: ['keeps it alive'] }, IDLE_MS * 2)
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(workers[0]!.killed).toBe(false)
    workers[0]!.reply({ id: workers[0]!.received[1]!.id, ok: true, result: [] })
    await busy

    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(workers[0]!.killed).toBe(true)
    expect(console.error).not.toHaveBeenCalled()

    void client.request({ kind: 'load', model: 'embedder' }, 1000).catch(() => {})
    expect(workers).toHaveLength(2)
  })

  it('shutdown rejects pending work, kills the worker and refuses new requests', async () => {
    const { client, workers } = setup()
    const pending = client.request(
      { kind: 'transcribe', samples: new Float32Array(4), chunkSeconds: 5 },
      1000
    )

    client.shutdown()
    await expect(pending).rejects.toThrow('ML worker shut down')
    expect(workers[0]!.killed).toBe(true)
    await expect(client.request({ kind: 'load', model: 'whisper' }, 1000)).rejects.toThrow(
      'ML worker is shut down'
    )
    expect(workers).toHaveLength(1)
    expect(console.error).not.toHaveBeenCalled()
  })
})
