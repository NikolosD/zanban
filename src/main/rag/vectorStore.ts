import { getDb } from './db.js'
import { getLocalEmbedder } from './embeddingProvider.js'
import type { Chunk } from './semanticChunker.js'

export interface RetrievedChunk {
  id: number
  sessionId: string
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

export async function indexChunks(sessionId: string, chunks: Chunk[]): Promise<number> {
  if (chunks.length === 0) return 0
  const db = await getDb()
  const embedder = await getLocalEmbedder()
  if (!db || !embedder) return 0

  const insertChunk = db.prepare(
    'INSERT INTO chunks (session_id, speaker, ts, text, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  const insertVec = db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)')

  const now = Date.now()
  const vectors = await embedder.embed(chunks.map((c) => c.text))
  let inserted = 0
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const v = vectors[i]
    if (!c || !v) continue
    const result = insertChunk.run(sessionId, c.speaker, c.ts, c.text, now)
    // sqlite-vec's vec0 strictly requires SQLITE_INTEGER for rowid binding.
    // better-sqlite3 may bind a JS number as REAL; force BigInt to guarantee INTEGER.
    insertVec.run(toBigIntId(result.lastInsertRowid), embeddingToBlob(v))
    inserted++
  }
  return inserted
}

/**
 * Find top-k chunks across ALL sessions semantically similar to `query`.
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
      `SELECT c.id as id, c.session_id as sessionId, c.speaker as speaker,
              c.ts as ts, c.text as text, v.distance as distance
       FROM chunks_vec v
       JOIN chunks c ON c.id = v.rowid
       WHERE v.embedding MATCH ?
       ORDER BY v.distance
       LIMIT ?`
    )
    .all<RetrievedChunk>(embeddingToBlob(vec), k)
  return rows
}

export async function deleteSession(sessionId: string): Promise<number> {
  const db = await getDb()
  if (!db) return 0
  const ids = db
    .prepare('SELECT id FROM chunks WHERE session_id = ?')
    .all<{ id: number | bigint }>(sessionId)
  if (ids.length === 0) return 0
  const delVec = db.prepare('DELETE FROM chunks_vec WHERE rowid = ?')
  for (const { id } of ids) delVec.run(toBigIntId(id))
  return Number(
    db.prepare('DELETE FROM chunks WHERE session_id = ?').run(sessionId).changes
  )
}

export async function countChunks(): Promise<number> {
  const db = await getDb()
  if (!db) return 0
  const row = db.prepare('SELECT COUNT(*) as n FROM chunks').get<{ n: number }>()
  return row?.n ?? 0
}
