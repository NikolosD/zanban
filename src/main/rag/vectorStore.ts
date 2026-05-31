import { getDb } from './db.js'
import { getLocalEmbedder } from './embeddingProvider.js'
import type { Chunk } from './semanticChunker.js'

/** What a stored chunk was derived from. */
export type SourceKind = 'session' | 'doc' | 'recap'

export interface RetrievedChunk {
  id: number
  /** What this chunk came from: a live session, a reference doc, or a recap. */
  sourceKind: SourceKind
  /** Session id (session/recap) or document id (doc). */
  sourceId: string
  /** Human-friendly label — doc filename for docs; null/unset for sessions. */
  sourceLabel: string | null
  speaker: string | null
  ts: number
  text: string
  /** L2 distance from sqlite-vec; lower = more similar. */
  distance: number
}

function embeddingToBlob(v: ArrayLike<number>): Buffer {
  const buf = Buffer.alloc(v.length * 4)
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i] as number, i * 4)
  return buf
}

function toBigIntId(id: number | bigint): bigint {
  return typeof id === 'bigint' ? id : BigInt(id)
}

interface IndexOptions {
  sourceKind: SourceKind
  sourceId: string
  sourceLabel?: string | null
}

/**
 * Embed + persist a batch of chunks under a given source. Shared by the
 * transcript indexer, the document indexer, and the recap indexer. Returns the
 * number of chunks actually inserted (0 if RAG is unavailable).
 */
async function indexSource(chunks: Chunk[], opts: IndexOptions): Promise<number> {
  if (chunks.length === 0) return 0
  const db = await getDb()
  const embedder = await getLocalEmbedder()
  if (!db || !embedder) return 0

  const insertChunk = db.prepare(
    'INSERT INTO chunks (source_kind, source_id, source_label, speaker, ts, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const insertVec = db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)')

  const now = Date.now()
  const vectors = await embedder.embed(chunks.map((c) => c.text))
  let inserted = 0
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const v = vectors[i]
    if (!c || !v) continue
    const result = insertChunk.run(
      opts.sourceKind,
      opts.sourceId,
      opts.sourceLabel ?? null,
      c.speaker,
      c.ts,
      c.text,
      now
    )
    // sqlite-vec's vec0 strictly requires SQLITE_INTEGER for rowid binding.
    // better-sqlite3 may bind a JS number as REAL; force BigInt to guarantee INTEGER.
    insertVec.run(toBigIntId(result.lastInsertRowid), embeddingToBlob(v))
    inserted++
  }
  return inserted
}

/** Index transcript chunks for a live session. */
export async function indexChunks(sessionId: string, chunks: Chunk[]): Promise<number> {
  return indexSource(chunks, { sourceKind: 'session', sourceId: sessionId })
}

/** Index reference-document chunks under a doc id (filename as label). */
export async function indexDocChunks(
  docId: string,
  label: string,
  chunks: Chunk[]
): Promise<number> {
  return indexSource(chunks, { sourceKind: 'doc', sourceId: docId, sourceLabel: label })
}

/** Index structured-recap chunks under their session id. */
export async function indexRecapChunks(sessionId: string, chunks: Chunk[]): Promise<number> {
  return indexSource(chunks, { sourceKind: 'recap', sourceId: sessionId })
}

const SELECT_COLS = `c.id as id, c.source_kind as sourceKind, c.source_id as sourceId,
                     c.source_label as sourceLabel, c.speaker as speaker,
                     c.ts as ts, c.text as text, v.distance as distance`

/**
 * Find top-k chunks across ALL sources semantically similar to `query`.
 * Returns empty array if RAG is unavailable (db or embedder failed to load).
 */
export async function search(query: string, k = 6): Promise<RetrievedChunk[]> {
  const db = await getDb()
  const embedder = await getLocalEmbedder()
  if (!db || !embedder || !query.trim()) return []

  const [vec] = await embedder.embed([query])
  if (!vec) return []

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS}
       FROM chunks_vec v
       JOIN chunks c ON c.id = v.rowid
       WHERE v.embedding MATCH ?
       ORDER BY v.distance
       LIMIT ?`
    )
    .all<RetrievedChunk>(embeddingToBlob(vec), k)
  return rows
}

/** Delete every chunk for a (sourceKind, sourceId) pair. Returns rows removed. */
async function deleteSource(sourceKind: SourceKind, sourceId: string): Promise<number> {
  const db = await getDb()
  if (!db) return 0
  const ids = db
    .prepare('SELECT id FROM chunks WHERE source_kind = ? AND source_id = ?')
    .all<{ id: number | bigint }>(sourceKind, sourceId)
  if (ids.length === 0) return 0
  const delVec = db.prepare('DELETE FROM chunks_vec WHERE rowid = ?')
  for (const { id } of ids) delVec.run(toBigIntId(id))
  return Number(
    db
      .prepare('DELETE FROM chunks WHERE source_kind = ? AND source_id = ?')
      .run(sourceKind, sourceId).changes
  )
}

/** Remove a session's transcript chunks AND its recap chunks. */
export async function deleteSession(sessionId: string): Promise<number> {
  const transcript = await deleteSource('session', sessionId)
  const recap = await deleteSource('recap', sessionId)
  return transcript + recap
}

/** Remove all chunks for a reference document. */
export async function deleteDoc(docId: string): Promise<number> {
  return deleteSource('doc', docId)
}

/** Remove a session's recap chunks only (used before re-indexing a fresh recap). */
export async function deleteRecap(sessionId: string): Promise<number> {
  return deleteSource('recap', sessionId)
}

export async function countChunks(): Promise<number> {
  const db = await getDb()
  if (!db) return 0
  const row = db.prepare('SELECT COUNT(*) as n FROM chunks').get<{ n: number }>()
  return row?.n ?? 0
}

/** Source ids of all currently-indexed reference documents. */
export async function indexedDocIds(): Promise<Set<string>> {
  const db = await getDb()
  if (!db) return new Set()
  const rows = db
    .prepare(`SELECT DISTINCT source_id as id FROM chunks WHERE source_kind = 'doc'`)
    .all<{ id: string }>()
  return new Set(rows.map((r) => r.id))
}
