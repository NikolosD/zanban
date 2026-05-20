import type { SessionDetailPayload } from '../../../shared/api.js'
import { readRecap, writeRecap, deleteRecap as deleteRecapFile } from './recapPersistence.js'
import type { RecapOptions, RecapPayload, RecapResult } from './recapSchema.js'

export interface RecapServiceDeps {
  dir: string
  readSession: (id: string) => Promise<SessionDetailPayload | null>
  llm: (session: SessionDetailPayload, options: RecapOptions) => Promise<RecapResult>
  onUpdated: (sessionId: string) => void
}

export interface RecapService {
  generate(sessionId: string, options: RecapOptions): Promise<RecapResult>
  get(sessionId: string): Promise<RecapPayload | null>
  delete(sessionId: string): Promise<void>
  isGenerating(sessionId: string): boolean
}

export function createRecapService(deps: RecapServiceDeps): RecapService {
  const inFlight = new Set<string>()

  async function generate(sessionId: string, options: RecapOptions): Promise<RecapResult> {
    if (inFlight.has(sessionId)) {
      return {
        ok: false,
        code: 'already_generating',
        message: 'Recap generation is already running for this session.'
      }
    }

    // Mark in-flight synchronously before any await so concurrent callers see it.
    inFlight.add(sessionId)
    try {
      const session = await deps.readSession(sessionId)
      if (!session || session.segments.length === 0) {
        return { ok: false, code: 'no_transcript', message: 'No transcript saved.' }
      }

      const result = await deps.llm(session, options)
      const toPersist = result.ok ? result.recap : (result.partial ?? null)
      if (toPersist) {
        await writeRecap(deps.dir, sessionId, toPersist)
        deps.onUpdated(sessionId)
      }
      return result
    } finally {
      inFlight.delete(sessionId)
    }
  }

  return {
    generate,
    get: (sessionId) => readRecap(deps.dir, sessionId),
    delete: async (sessionId) => {
      await deleteRecapFile(deps.dir, sessionId)
      deps.onUpdated(sessionId)
    },
    isGenerating: (sessionId) => inFlight.has(sessionId)
  }
}
