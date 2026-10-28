import { describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment, TranscriptionStatus } from '../../shared/types.js'

vi.mock('@xenova/transformers', () => ({
  pipeline: async () => async () => ({ text: 'last words' })
}))
vi.mock('../services/jobsManager.js', () => ({
  trackJob: (_id: string, _title: string, _kind: string, fn: () => Promise<unknown>) => fn()
}))

const { LocalWhisperSttChannel } = await import('./localWhisperClient.js')

describe('LocalWhisperSttChannel', () => {
  it('transcribes the buffered tail on close instead of dropping it', async () => {
    const segments: TranscriptSegment[] = []
    const statuses: TranscriptionStatus[] = []
    const ch = new LocalWhisperSttChannel({
      language: 'en',
      channel: 'mic',
      onSegment: (s) => segments.push(s),
      onStatus: (s) => statuses.push(s)
    })
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
})
