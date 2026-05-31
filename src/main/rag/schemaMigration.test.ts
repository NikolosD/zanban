import { describe, it, expect } from 'vitest'
import { decideMigration, RAG_SCHEMA_VERSION, type RagMeta } from './schemaMigration.js'

const current = { embeddingDim: 384, embeddingModel: 'Xenova/all-MiniLM-L6-v2' }

function meta(over: Partial<RagMeta> = {}): RagMeta {
  return {
    schemaVersion: RAG_SCHEMA_VERSION,
    embeddingDim: 384,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    ...over
  }
}

describe('decideMigration', () => {
  it('never rebuilds a fresh (null) database', () => {
    expect(decideMigration(null, current)).toEqual({ rebuild: false, reason: null })
  })

  it('does not rebuild when everything matches', () => {
    expect(decideMigration(meta(), current)).toEqual({ rebuild: false, reason: null })
  })

  it('rebuilds on a schema-version change', () => {
    const d = decideMigration(meta({ schemaVersion: RAG_SCHEMA_VERSION - 1 }), current)
    expect(d).toEqual({ rebuild: true, reason: 'schema-version' })
  })

  it('rebuilds on an embedding-dimension change', () => {
    const d = decideMigration(meta({ embeddingDim: 768 }), current)
    expect(d).toEqual({ rebuild: true, reason: 'embedding-dim' })
  })

  it('rebuilds on an embedding-model change', () => {
    const d = decideMigration(meta({ embeddingModel: 'other/model' }), current)
    expect(d).toEqual({ rebuild: true, reason: 'embedding-model' })
  })

  it('prioritizes schema-version over dim/model when several differ', () => {
    const d = decideMigration(
      meta({ schemaVersion: 0, embeddingDim: 768, embeddingModel: 'x' }),
      current
    )
    expect(d.reason).toBe('schema-version')
  })

  it('prioritizes dim over model when both differ but schema matches', () => {
    const d = decideMigration(meta({ embeddingDim: 768, embeddingModel: 'x' }), current)
    expect(d.reason).toBe('embedding-dim')
  })
})
