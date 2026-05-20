import type { AppSettings } from '../../../shared/types.js'
import type { RecapResult } from './recapSchema.js'

export interface AutoTriggerDeps {
  getSettings: () => AppSettings
  generate: (sessionId: string, options: Record<string, never>) => Promise<RecapResult>
  trackJob: (
    id: string,
    title: string,
    kind: 'other',
    fn: () => Promise<unknown>
  ) => Promise<unknown>
}

export interface AutoTrigger {
  onSessionStopped(sessionId: string): Promise<void>
}

export function createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger {
  return {
    async onSessionStopped(sessionId: string): Promise<void> {
      const { autoGenerate } = deps.getSettings().recap
      if (!autoGenerate) return
      try {
        await deps.trackJob(`recap-${sessionId}`, 'Generating meeting recap', 'other', () =>
          deps.generate(sessionId, {})
        )
      } catch {
        // Swallow — auto-trigger is best-effort. The user did not request
        // this explicitly, so surfacing a modal/toast would be noise.
        // jobsManager already marks it failed visually.
      }
    }
  }
}
