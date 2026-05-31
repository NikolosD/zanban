import type { AppSettings } from '../../../shared/types.js'
import type { RecapPayload, RecapResult } from './recapSchema.js'

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
  /**
   * Returns the recap currently persisted for a session, or null. Used to skip
   * auto-generation when a complete recap already exists — without this guard a
   * resume+stop cycle would overwrite a full recap (and a partial regeneration
   * could clobber it). Optional for backwards-compat with existing callers.
   */
  getExisting?: (sessionId: string) => Promise<RecapPayload | null>
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
      // Don't clobber an existing complete recap. After a resume+stop the
      // session already has a full recap from the first stop — regenerating
      // would overwrite it (and risk replacing it with a partial). A partial
      // recap is allowed to be retried.
      if (deps.getExisting) {
        const existing = await deps.getExisting(sessionId).catch(() => null)
        if (existing && !existing.partial) return
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
