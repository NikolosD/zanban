import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION as PV_MAIN } from './recapPrompt.js'
import { RECAP_SCHEMA_VERSION as SV_MAIN } from './recapSchema.js'
import {
  PROMPT_VERSION as PV_SHARED,
  RECAP_SCHEMA_VERSION as SV_SHARED
} from '../../../shared/recap-types.js'

describe('version consistency between main and shared', () => {
  it('PROMPT_VERSION matches', () => {
    expect(PV_MAIN).toBe(PV_SHARED)
  })
  it('RECAP_SCHEMA_VERSION matches', () => {
    expect(SV_MAIN).toBe(SV_SHARED)
  })
})
