import type { SessionDetailPayload } from '../../../shared/api.js'
import type { GlobalActionItem } from '../../../shared/recap-types.js'
import {
  readRecap,
  writeRecap,
  deleteRecap as deleteRecapFile,
  listRecapIds
} from './recapPersistence.js'
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
  /** Aggregate every "owner: you" action item across all recaps for the global
   *  panel. Checked-off filtering happens in the renderer (localStorage). */
  listMyActionItems(): Promise<GlobalActionItem[]>
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
        // Never let a partial (incomplete model JSON) overwrite a complete
        // recap on disk — a flaky regeneration shouldn't downgrade a good
        // result. A complete result always wins and replaces whatever exists.
        if (toPersist.partial) {
          const existing = await readRecap(deps.dir, sessionId)
          if (existing && !existing.partial) {
            return result
          }
        }
        await writeRecap(deps.dir, sessionId, toPersist)
        deps.onUpdated(sessionId)
      }
      return result
    } finally {
      inFlight.delete(sessionId)
    }
  }

  async function listMyActionItems(): Promise<GlobalActionItem[]> {
    const ids = await listRecapIds(deps.dir)
    const items: GlobalActionItem[] = []
    // Read recaps in parallel; each recap is small and there are rarely many.
    const recaps = await Promise.all(
      ids.map(async (id) => ({ id, recap: await readRecap(deps.dir, id).catch(() => null) }))
    )
    // Session metadata (title/startedAt) for each recap that has "you" items.
    for (const { id, recap } of recaps) {
      if (!recap) continue
      const mine = recap.actionItems.filter((a) => a.owner === 'you')
      if (mine.length === 0) continue
      const session = await deps.readSession(id).catch(() => null)
      for (const a of mine) {
        items.push({
          sessionId: id,
          sessionTitle: session?.title ?? null,
          sessionStartedAt: session?.startedAt ?? recap.generatedAt,
          text: a.text,
          dueHint: a.dueHint
        })
      }
    }
    // Newest sessions first so the freshest commitments float to the top.
    items.sort((a, b) => b.sessionStartedAt - a.sessionStartedAt)
    return items
  }

  return {
    generate,
    get: (sessionId) => readRecap(deps.dir, sessionId),
    delete: async (sessionId) => {
      await deleteRecapFile(deps.dir, sessionId)
      deps.onUpdated(sessionId)
    },
    isGenerating: (sessionId) => inFlight.has(sessionId),
    listMyActionItems
  }
}
