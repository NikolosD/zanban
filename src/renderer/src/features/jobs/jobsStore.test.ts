import { afterEach, describe, expect, it } from 'vitest'
import type { BackgroundJob } from '@shared/api'
import { useJobs } from './jobsStore'

const job = (id: string): BackgroundJob => ({ id, title: id, kind: 'other', startedAt: 0 })

afterEach(() => {
  useJobs.setState({ jobs: [], finished: new Set() })
})

describe('useJobs', () => {
  it('remembers a job that was running and then left the list', () => {
    useJobs.getState().set([job('a'), job('b')])
    expect(useJobs.getState().finished.size).toBe(0)

    useJobs.getState().set([job('b')])
    expect([...useJobs.getState().finished]).toEqual(['a'])
  })

  it('forgets a finished job once it runs again', () => {
    useJobs.getState().set([job('a')])
    useJobs.getState().set([])
    expect(useJobs.getState().finished.has('a')).toBe(true)

    useJobs.getState().set([job('a')])
    expect(useJobs.getState().finished.has('a')).toBe(false)
  })
})
