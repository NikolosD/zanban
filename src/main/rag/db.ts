import { app } from 'electron'
import { join } from 'node:path'

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  speaker TEXT,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_ts ON chunks(ts);
`

const VEC_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  embedding float[384]
);
`

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
    db.exec(SCHEMA)
    db.exec(VEC_SCHEMA)
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
