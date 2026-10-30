import { create } from 'zustand'
import type { BackgroundJob } from '@shared/api'

interface JobsState {
  jobs: BackgroundJob[]
  /** Jobs seen running that have since ended. A view opened after a quick job
   *  can't otherwise tell "not started yet" from "already done". */
  finished: ReadonlySet<string>
  set(jobs: BackgroundJob[]): void
}

export const useJobs = create<JobsState>((set) => ({
  jobs: [],
  finished: new Set(),
  set: (jobs) =>
    set((state) => {
      const finished = new Set([...state.finished, ...state.jobs.map((j) => j.id)])
      for (const job of jobs) finished.delete(job.id)
      return { jobs, finished }
    })
}))

export function wireJobsIpc(): () => void {
  return window.zanban.jobs.onState((jobs) => {
    useJobs.getState().set(jobs)
  })
}
