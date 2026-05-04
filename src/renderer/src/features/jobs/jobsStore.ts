import { create } from 'zustand'
import type { BackgroundJob } from '@shared/api'

interface JobsState {
  jobs: BackgroundJob[]
  set(jobs: BackgroundJob[]): void
}

export const useJobs = create<JobsState>((set) => ({
  jobs: [],
  set: (jobs) => set({ jobs })
}))

export function wireJobsIpc(): () => void {
  return window.zanban.jobs.onState((jobs) => {
    useJobs.getState().set(jobs)
  })
}
