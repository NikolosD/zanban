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
  awaitFinalized?: (sessionId: string) => Promise<void>
}

export interface AutoTrigger {
  onSessionStopped(sessionId: string): Promise<void>
}

export function createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger {
  return {
    async onSessionStopped(sessionId: string): Promise<void> {
      const { autoGenerate } = deps.getSettings().recap
      if (!autoGenerate) return
      if (deps.awaitFinalized) {
        await deps.awaitFinalized(sessionId).catch(() => undefined)
      }
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
