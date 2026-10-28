import { app } from 'electron'
import { join } from 'node:path'
import { LOCAL_EMBEDDING_DIM, LOCAL_EMBEDDING_ID } from './embeddingProvider.js'
import { decideMigration, RAG_SCHEMA_VERSION, type RagMeta } from './schemaMigration.js'

type Database = {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    get<T = unknown>(...params: unknown[]): T | undefined
    all<T = unknown>(...params: unknown[]): T[]
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  close(): void
  pragma(s: string, opts?: { simple?: boolean }): unknown
  loadExtension(path: string): void
}

let dbPromise: Promise<Database | null> | null = null
let dbInstance: Database | null = null

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

const BACKFILL_KEY = 'backfill_pending'
const BACKFILL_DELAY_MS = 15_000

function vecSchema(dim: number): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${dim}]);`
}

function readMeta(db: Database): RagMeta | null {
  // PRAGMA user_version is the canonical schema-generation marker; the embedding
  // dim/model live in the rag_meta key/value table. A DB created before either
  // existed reports user_version 0 and has no meta rows → treated as a fresh
  // legacy store that needs the schema-version rebuild path.
  // `simple` returns the bare value; the default row array made this NaN, which
  // read as a schema mismatch and wiped the index on every launch.
  const userVersion = Number(db.pragma('user_version', { simple: true }) ?? 0)
  if (userVersion === 0) return null
  const rows = db.prepare('SELECT key, value FROM rag_meta').all<{ key: string; value: string }>()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const dim = Number(map.get('embedding_dim'))
  const model = map.get('embedding_model')
  if (!Number.isFinite(dim) || !model) return null
  return { schemaVersion: userVersion, embeddingDim: dim, embeddingModel: model }
}

// The initial schema keyed chunks by `session_id` and predates user_version, so
// it reads as a fresh DB — and SCHEMA's source_kind index fails against it.
function hasLegacyChunksTable(db: Database): boolean {
  const cols = db.prepare('PRAGMA table_info(chunks)').all<{ name: string }>()
  return cols.length > 0 && !cols.some((c) => c.name === 'source_kind')
}

function setMetaValue(db: Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO rag_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

function writeMeta(db: Database, meta: RagMeta): void {
  db.pragma(`user_version = ${meta.schemaVersion}`)
  setMetaValue(db, 'embedding_dim', String(meta.embeddingDim))
  setMetaValue(db, 'embedding_model', meta.embeddingModel)
}

/**
 * Drop and recreate the chunk + vec tables, discarding all indexed data. Called
 * when decideMigration reports the persisted store is incompatible with the
 * current build (schema bump or a new embedding model/dimension). Documents are
 * re-indexed on boot by docIndexer.reconcileDocs; past transcripts and recaps
 * by sessionBackfill.
 */
function recreateSchema(db: Database, dim: number): void {
  db.exec('DROP TABLE IF EXISTS chunks_vec;')
  db.exec('DROP TABLE IF EXISTS chunks;')
  db.exec(SCHEMA)
  db.exec(vecSchema(dim))
}

function migrate(db: Database): void {
  const dim = LOCAL_EMBEDDING_DIM
  const model = LOCAL_EMBEDDING_ID
  // Whenever the chunk table starts out empty, past sessions on disk must be
  // re-indexed; the flag survives a quit mid-backfill.
  let startsEmpty = true
  if (hasLegacyChunksTable(db)) {
    console.warn('[rag] migrating legacy session-only schema — reindexing required')
    recreateSchema(db, dim)
  } else {
    db.exec(SCHEMA)
    const stored = readMeta(db)
    const decision = decideMigration(stored, { embeddingDim: dim, embeddingModel: model })
    if (decision.rebuild) {
      console.warn(`[rag] migrating vec schema (reason: ${decision.reason}) — reindexing required`)
      recreateSchema(db, dim)
    } else {
      db.exec(vecSchema(dim))
    }
    startsEmpty = stored === null || decision.rebuild
  }
  writeMeta(db, { schemaVersion: RAG_SCHEMA_VERSION, embeddingDim: dim, embeddingModel: model })
  if (startsEmpty) setMetaValue(db, BACKFILL_KEY, '1')
}

async function openDb(): Promise<Database | null> {
  try {
    const Database = (await import('better-sqlite3')).default
    const sqliteVec = await import('sqlite-vec')
    const dbPath = join(app.getPath('userData'), 'rag.sqlite3')
    const db = new Database(dbPath) as unknown as Database
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    // sqlite-vec resolves its DLL inside app.asar in packaged builds, where
    // SQLite can't load it; electron-builder unpacks it next to the archive.
    const vecPath = sqliteVec.getLoadablePath().replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    db.loadExtension(vecPath)
    db.transaction(() => migrate(db))()
    dbInstance = db

    const pending = db
      .prepare('SELECT value FROM rag_meta WHERE key = ?')
      .get<{ value: string }>(BACKFILL_KEY)
    if (pending) {
      setTimeout(() => {
        void import('./sessionBackfill.js')
          .then((m) => m.backfillSessions())
          .catch((err: unknown) => console.error('[rag] session backfill failed', err))
      }, BACKFILL_DELAY_MS)
    }
    return db
  } catch (err) {
    console.error('[rag] db init failed', err)
    return null
  }
}

/**
 * Open (or open-and-init) the RAG SQLite database in userData. Returns null
 * when better-sqlite3 / sqlite-vec fail to load — the rest of the app keeps
 * working, RAG just becomes a no-op. Memoized as a promise so concurrent first
 * callers share one migration instead of racing it.
 */
export function getDb(): Promise<Database | null> {
  dbPromise ??= openDb()
  return dbPromise
}

export async function clearBackfillPending(): Promise<void> {
  const db = await getDb()
  db?.prepare('DELETE FROM rag_meta WHERE key = ?').run(BACKFILL_KEY)
}

/** Close on quit. Later callers (a straggling flush or backfill) get null rather than a reopen. */
export function closeDb(): void {
  dbPromise = Promise.resolve(null)
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {
      /* ignore */
    }
    dbInstance = null
  }
}
