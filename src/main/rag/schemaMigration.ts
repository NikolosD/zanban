/**
 * Pure decision logic for the RAG vector-schema version.
 *
 * The sqlite-vec virtual table pins the embedding dimension at creation time
 * (`float[N]`). If the embedding model — and therefore N — ever changes, the
 * old vectors become incompatible: MATCH/INSERT against a `float[384]` table
 * with 768-dim vectors silently corrupts queries. We persist the embedding
 * dimension + model id in a small meta table and compare on every boot; a
 * mismatch means we must rebuild the vec table (drop + recreate + reindex)
 * rather than keep querying garbage.
 *
 * The bump-on-incompatible-change rule lives here as a pure function so it can
 * be unit-tested without touching better-sqlite3 / sqlite-vec.
 */

/**
 * Schema generation. Bump this when the *shape* of the chunks/vec tables
 * changes in a way that requires a rebuild (e.g. adding the source columns).
 * Independent of the embedding dimension, which is tracked separately.
 */
export const RAG_SCHEMA_VERSION = 2

export interface RagMeta {
  /** Schema generation the DB was last written with (PRAGMA user_version). */
  schemaVersion: number
  /** Embedding dimensionality the vec table was created with. */
  embeddingDim: number
  /** Embedding model id the vectors were produced with. */
  embeddingModel: string
}

export interface MigrationDecision {
  /**
   * True when the existing vec/chunks tables are incompatible with the current
   * code or embedding model and must be dropped + recreated + reindexed.
   */
  rebuild: boolean
  /** Short machine-readable reason, for logging. Null when no rebuild needed. */
  reason: 'schema-version' | 'embedding-dim' | 'embedding-model' | null
}

/**
 * Decide whether the persisted RAG store is compatible with the current build.
 *
 * @param stored  Meta read from the DB, or null on a fresh / pre-meta database.
 * @param current The dimension + model id the running embedder will produce.
 *
 * A fresh DB (stored === null) never needs a rebuild — the caller just creates
 * the tables. A change in schema version, embedding dimension, or embedding
 * model all force a rebuild, in that priority order so logs point at the most
 * fundamental cause first.
 */
export function decideMigration(
  stored: RagMeta | null,
  current: { embeddingDim: number; embeddingModel: string }
): MigrationDecision {
  if (!stored) return { rebuild: false, reason: null }
  if (stored.schemaVersion !== RAG_SCHEMA_VERSION) {
    return { rebuild: true, reason: 'schema-version' }
  }
  if (stored.embeddingDim !== current.embeddingDim) {
    return { rebuild: true, reason: 'embedding-dim' }
  }
  if (stored.embeddingModel !== current.embeddingModel) {
    return { rebuild: true, reason: 'embedding-model' }
  }
  return { rebuild: false, reason: null }
}
