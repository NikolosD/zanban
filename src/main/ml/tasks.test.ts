import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transformers = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  loads: [] as Array<{ task: string; model: string; revision?: string }>,
  disposes: [] as string[],
  asrCalls: [] as Array<{ input: Float32Array; opts: unknown }>,
  failNextLoad: false
}))

vi.mock('@xenova/transformers', () => ({
  env: transformers.env,
  pipeline: async (task: string, model: string, opts?: { revision?: string }) => {
    if (transformers.failNextLoad) {
      transformers.failNextLoad = false
      throw new Error('offline')
    }
    transformers.loads.push({ task, model, revision: opts?.revision })
    const run =
      task === 'automatic-speech-recognition'
        ? async (input: Float32Array, runOpts: unknown) => {
            transformers.asrCalls.push({ input, opts: runOpts })
            return { text: '  hello there ' }
          }
        : async (text: string) => ({ data: new Float32Array([text.length, 0]) })
    return Object.assign(run, {
      dispose: async () => {
        transformers.disposes.push(task)
      }
    })
  }
}))

const { createMlTasks } = await import('./tasks.js')

describe('createMlTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    transformers.loads = []
    transformers.disposes = []
    transformers.asrCalls = []
    transformers.failNextLoad = false
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('points the model cache at the directory it was given', async () => {
    const tasks = createMlTasks('/user-data/models')
    await tasks.run({ kind: 'load', model: 'whisper' })
    expect(transformers.env).toMatchObject({
      cacheDir: '/user-data/models',
      allowLocalModels: false
    })
  })

  it('loads Whisper once for concurrent callers and returns the trimmed transcript', async () => {
    const tasks = createMlTasks('models')
    const samples = new Float32Array([0.1, 0.2])
    const [, text] = await Promise.all([
      tasks.run({ kind: 'load', model: 'whisper' }),
      tasks.run({ kind: 'transcribe', samples, language: 'ru', chunkSeconds: 5 })
    ])
    expect(text).toBe('hello there')
    expect(transformers.loads).toEqual([
      { task: 'automatic-speech-recognition', model: 'Xenova/whisper-tiny', revision: undefined }
    ])
    expect(transformers.asrCalls).toEqual([
      { input: samples, opts: { language: 'ru', task: 'transcribe', chunk_length_s: 5 } }
    ])
  })

  it('drops Whisper after a minute without batches and reloads it on the next one', async () => {
    const tasks = createMlTasks('models')
    const batch = { kind: 'transcribe', samples: new Float32Array(1), chunkSeconds: 5 } as const
    await tasks.run(batch)
    await vi.advanceTimersByTimeAsync(59_000)
    await tasks.run(batch)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(transformers.disposes).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    expect(transformers.disposes).toEqual(['automatic-speech-recognition'])
    await tasks.run(batch)
    expect(transformers.loads).toHaveLength(2)
  })

  it('embeds each text with the pinned encoder and retries a failed load', async () => {
    vi.useRealTimers()
    const tasks = createMlTasks('models')
    transformers.failNextLoad = true
    await expect(tasks.run({ kind: 'load', model: 'embedder' })).rejects.toThrow('offline')

    const vectors = await tasks.run({ kind: 'embed', texts: ['abc', 'de'] })
    expect(vectors).toEqual([new Float32Array([3, 0]), new Float32Array([2, 0])])
    expect(transformers.loads).toEqual([
      {
        task: 'feature-extraction',
        model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900'
      }
    ])
  })
})
