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

  it('drops a finished job on request so a later view waits for its next run', () => {
    useJobs.getState().set([job('a'), job('b')])
    useJobs.getState().set([])

    useJobs.getState().forget('a')

    expect([...useJobs.getState().finished]).toEqual(['b'])
  })

  it('keeps only the most recent finished jobs', () => {
    for (let i = 0; i < 300; i++) useJobs.getState().set([job(`job-${i}`)])
    useJobs.getState().set([])

    const { finished } = useJobs.getState()
    expect(finished.size).toBeLessThanOrEqual(200)
    expect(finished.has('job-299')).toBe(true)
    expect(finished.has('job-0')).toBe(false)
  })
})
