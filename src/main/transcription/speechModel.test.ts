import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userData: '',
  request: vi.fn(
    async (_task: unknown, _timeoutMs: number, onProgress?: (fraction: number) => void) => {
      onProgress?.(0.5)
    }
  )
}))

vi.mock('electron', () => ({ app: { getPath: () => h.userData } }))
vi.mock('../ml/index.js', () => ({ speechWorker: { request: h.request } }))

const { loadSpeechModel, speechModelStatus } = await import('./speechModel.js')
const { PARAKEET_DIR, PARAKEET_FILES } = await import('../ml/models.js')

const total = PARAKEET_FILES.reduce((sum, f) => sum + f.bytes, 0)

beforeEach(async () => {
  h.userData = await mkdtemp(join(tmpdir(), 'zanban-speech-'))
})

afterEach(async () => {
  await rm(h.userData, { recursive: true, force: true })
})

async function place(...names: string[]) {
  const dir = join(h.userData, 'models', PARAKEET_DIR)
  await mkdir(dir, { recursive: true })
  for (const name of names) await writeFile(join(dir, name), '')
}

describe('speechModelStatus', () => {
  it('counts the whole model as missing before the first download', async () => {
    expect(await speechModelStatus()).toEqual({ installed: false, missingBytes: total })
  })

  it('counts only the files still missing after a download was cut short', async () => {
    await place('tokens.txt', 'silero_vad.onnx', 'encoder.int8.onnx.part')
    const left = PARAKEET_FILES.filter((f) => !['tokens.txt', 'silero_vad.onnx'].includes(f.name))
    expect(await speechModelStatus()).toEqual({
      installed: false,
      missingBytes: left.reduce((sum, f) => sum + f.bytes, 0)
    })
  })

  it('reports the model installed once every file is there', async () => {
    await place(...PARAKEET_FILES.map((f) => f.name))
    expect(await speechModelStatus()).toEqual({ installed: true, missingBytes: 0 })
  })
})

describe('loadSpeechModel', () => {
  it('loads the model in the speech process and passes its progress on', async () => {
    const progress: number[] = []
    await loadSpeechModel((fraction) => progress.push(fraction))
    expect(h.request).toHaveBeenCalledWith(
      { kind: 'load', model: 'parakeet' },
      expect.any(Number),
      expect.any(Function)
    )
    expect(progress).toEqual([0.5])
  })
})
