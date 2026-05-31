import { app } from 'electron'
import { join } from 'node:path'
import { getLocalEmbedder, LOCAL_EMBEDDING_MODEL } from './embeddingProvider.js'
import { decideMigration, RAG_SCHEMA_VERSION, type RagMeta } from './schemaMigration.js'

type Database = {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    get<T = unknown>(...params: unknown[]): T | undefined
    all<T = unknown>(...params: unknown[]): T[]
  }
  close(): void
  pragma(s: string): unknown
}

let dbInstance: Database | null = null
let initFailed = false

/**
 * `source_kind` distinguishes transcript chunks from reference-document and
 * structured-recap chunks; `source_id` is the session id (transcript/recap) or
 * doc id (documents). Both feed the same vec table so retrieval ranks across
 * all of them. The legacy `session_id`-only schema is migrated by a rebuild
 * (RAG_SCHEMA_VERSION bump → decideMigration → recreateVecSchema).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL DEFAULT 'session',
  source_id TEXT NOT NULL,
  source_label TEXT,
  speaker TEXT,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_ts ON chunks(ts);
CREATE TABLE IF NOT EXISTS rag_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const VEC_DIM = 384

function vecSchema(dim: number): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${dim}]);`
}

function readMeta(db: Database): RagMeta | null {
  // PRAGMA user_version is the canonical schema-generation marker; the embedding
  // dim/model live in the rag_meta key/value table. A DB created before either
  // existed reports user_version 0 and has no meta rows → treated as a fresh
  // legacy store that needs the schema-version rebuild path.
  const userVersion = Number(db.pragma('user_version') ?? 0)
  if (userVersion === 0) return null
  const rows = db.prepare('SELECT key, value FROM rag_meta').all<{ key: string; value: string }>()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const dim = Number(map.get('embedding_dim'))
  const model = map.get('embedding_model')
  if (!Number.isFinite(dim) || !model) return null
  return { schemaVersion: userVersion, embeddingDim: dim, embeddingModel: model }
}

function writeMeta(db: Database, meta: RagMeta): void {
  db.pragma(`user_version = ${meta.schemaVersion}`)
  const up = db.prepare(
    'INSERT INTO rag_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  up.run('embedding_dim', String(meta.embeddingDim))
  up.run('embedding_model', meta.embeddingModel)
}

/**
 * Drop and recreate the chunk + vec tables, discarding all indexed data. Called
 * when decideMigration reports the persisted store is incompatible with the
 * current build (schema bump or a new embedding model/dimension). Live indexers
 * re-populate transcript chunks on the next session; documents are re-indexed
 * on boot by docIndexer.reconcileDocs.
 */
function recreateSchema(db: Database, dim: number): void {
  db.exec('DROP TABLE IF EXISTS chunks_vec;')
  db.exec('DROP TABLE IF EXISTS chunks;')
  db.exec(SCHEMA)
  db.exec(vecSchema(dim))
}

/**
 * Open (or open-and-init) the RAG SQLite database in userData. Returns null
 * when better-sqlite3 / sqlite-vec fail to load — the rest of the app keeps
 * working, RAG just becomes a no-op.
 */
export async function getDb(): Promise<Database | null> {
  if (dbInstance) return dbInstance
  if (initFailed) return null
  try {
    const Database = (await import('better-sqlite3')).default
    const sqliteVec = await import('sqlite-vec')
    const dbPath = join(app.getPath('userData'), 'rag.sqlite3')
    const db = new Database(dbPath) as unknown as Database
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    ;(sqliteVec as { load: (d: unknown) => void }).load(db)

    // Resolve the embedder's identity up front so the meta we persist matches
    // the vectors we'll write. Fall back to the known local model id if the
    // embedder failed to load — we still want a consistent schema on disk.
    const embedder = await getLocalEmbedder()
    const dim = embedder?.dim ?? VEC_DIM
    const model = embedder?.model ?? LOCAL_EMBEDDING_MODEL

    db.exec(SCHEMA)
    const stored = readMeta(db)
    const decision = decideMigration(stored, { embeddingDim: dim, embeddingModel: model })
    if (decision.rebuild) {
      console.warn(`[rag] migrating vec schema (reason: ${decision.reason}) — reindexing required`)
      recreateSchema(db, dim)
    } else {
      db.exec(vecSchema(dim))
    }
    writeMeta(db, { schemaVersion: RAG_SCHEMA_VERSION, embeddingDim: dim, embeddingModel: model })

    dbInstance = db
    return db
  } catch (err) {
    console.error('[rag] db init failed', err)
    initFailed = true
    return null
  }
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {
      /* ignore */
    }
    dbInstance = null
  }
}
