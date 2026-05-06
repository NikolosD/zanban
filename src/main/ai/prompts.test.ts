import { describe, it, expect, vi } from 'vitest'
import type { ResponseLanguage, TranscriptSegment } from '../../shared/types.js'

// Reference docs come from a stateful main-process store (electron + fs);
// stub it out so prompt-building can be tested in pure-fn isolation.
const refContext = vi.hoisted(() => ({ value: '' }))
vi.mock('../documents/referenceStore.js', () => ({
  getActiveContext: () => refContext.value
}))

const { buildSystemPrompt, buildVisionSystemPrompt, buildUserPrompt } = await import('./prompts.js')

describe('buildSystemPrompt', () => {
  it('returns the bare system prompt when no persona / language given', () => {
    const out = buildSystemPrompt()
    expect(out).toContain('You are Zanban')
    expect(out).not.toContain('Forced response language')
    expect(out).not.toContain('Who the user is')
  })

  it('appends a language directive when a non-auto language is given', () => {
    const out = buildSystemPrompt(undefined, 'ru')
    expect(out).toContain('Forced response language: write the answer in Russian')
  })

  it('treats "auto" language as no override', () => {
    expect(buildSystemPrompt(undefined, 'auto' as ResponseLanguage)).toBe(buildSystemPrompt())
  })

  it('appends persona block when a non-empty persona is given', () => {
    const out = buildSystemPrompt('I am a senior backend engineer.')
    expect(out).toContain('Who the user is (persona):')
    expect(out).toContain('I am a senior backend engineer.')
    expect(out).toContain('Tailor your answers to this persona')
  })

  it('ignores whitespace-only persona', () => {
    expect(buildSystemPrompt('   \n\t  ')).toBe(buildSystemPrompt())
  })

  it('places language directive BEFORE persona block', () => {
    const out = buildSystemPrompt('I am a senior backend engineer.', 'es')
    const langIdx = out.indexOf('Forced response language')
    const personaIdx = out.indexOf('Who the user is')
    expect(langIdx).toBeGreaterThan(-1)
    expect(personaIdx).toBeGreaterThan(-1)
    expect(langIdx).toBeLessThan(personaIdx)
  })

  it('renders every supported language code', () => {
    const codes: ResponseLanguage[] = ['en', 'ru', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'ko', 'zh']
    for (const code of codes) {
      const out = buildSystemPrompt(undefined, code)
      expect(out).toContain('Forced response language: write the answer in')
      // Each locale resolves to a non-empty name (English / Russian / …).
      const m = out.match(/Forced response language: write the answer in ([^,]+),/)
      expect(m?.[1]?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('buildVisionSystemPrompt', () => {
  it('uses the vision base prompt — not the chat one', () => {
    const out = buildVisionSystemPrompt()
    expect(out).toContain('attached a screenshot')
    expect(out).toContain('coding problem')
    expect(out).not.toContain('Hard rules:')
  })

  it('honors language and persona the same way as buildSystemPrompt', () => {
    const out = buildVisionSystemPrompt('I am a frontend engineer', 'fr')
    expect(out).toContain('Forced response language: write the answer in French')
    expect(out).toContain('I am a frontend engineer')
  })
})

describe('buildUserPrompt', () => {
  function seg(overrides: Partial<TranscriptSegment>): TranscriptSegment {
    return {
      id: overrides.id ?? 's1',
      channel: overrides.channel ?? 'mic',
      speaker: overrides.speaker ?? 0,
      startMs: overrides.startMs ?? 0,
      endMs: overrides.endMs ?? 1_000,
      text: overrides.text ?? '',
      isFinal: overrides.isFinal ?? true,
      createdAt: overrides.createdAt ?? Date.now()
    }
  }

  it('emits an empty-transcript marker when there is nothing to show', () => {
    refContext.value = ''
    const out = buildUserPrompt({
      userPrompt: 'hello?',
      meetingContext: '',
      segments: [],
      contextSeconds: 60
    })
    expect(out).toContain('<recent_transcript>')
    expect(out).toContain('(no transcript yet)')
    expect(out).toContain('<user_request>\nhello?\n</user_request>')
  })

  it('labels mic segments as You and system segments as Them', () => {
    refContext.value = ''
    const now = Date.now()
    const out = buildUserPrompt({
      userPrompt: 'q',
      meetingContext: '',
      contextSeconds: 60,
      segments: [
        seg({ id: '1', channel: 'mic', text: 'hi', createdAt: now }),
        seg({ id: '2', channel: 'system', text: 'hey', createdAt: now })
      ]
    })
    expect(out).toContain('[You] hi')
    expect(out).toContain('[Them] hey')
  })

  it('drops non-final segments and segments older than the cutoff', () => {
    refContext.value = ''
    const now = Date.now()
    const out = buildUserPrompt({
      userPrompt: 'q',
      meetingContext: '',
      contextSeconds: 60,
      segments: [
        seg({ id: '1', text: 'kept', createdAt: now, isFinal: true }),
        seg({ id: '2', text: 'partial', createdAt: now, isFinal: false }),
        seg({ id: '3', text: 'old', createdAt: now - 120_000, isFinal: true })
      ]
    })
    expect(out).toContain('kept')
    expect(out).not.toContain('partial')
    expect(out).not.toContain('old')
  })

  it('wraps meeting context, OCR text, exchanges, and retrieved history in their tags', () => {
    refContext.value = ''
    const out = buildUserPrompt({
      userPrompt: 'go',
      meetingContext: 'interview for senior FE role',
      contextSeconds: 60,
      segments: [],
      ocrText: 'console.log(1)',
      exchanges: [
        { prompt: 'hi', answer: 'hello' },
        { prompt: 'next?', answer: 'sure' }
      ],
      retrievedHistory: '\n\n<retrieved_history>\nold note\n</retrieved_history>'
    })
    expect(out).toContain('<meeting_context>\ninterview for senior FE role\n</meeting_context>')
    expect(out).toContain('<screen_ocr>')
    expect(out).toContain('console.log(1)')
    expect(out).toContain('<previous_exchanges>')
    expect(out).toContain('--- exchange 1 ---')
    expect(out).toContain('--- exchange 2 ---')
    expect(out).toContain('<retrieved_history>')
  })

  it('skips empty optional blocks', () => {
    refContext.value = ''
    const out = buildUserPrompt({
      userPrompt: 'go',
      meetingContext: '   ',
      contextSeconds: 60,
      segments: [],
      ocrText: '   ',
      exchanges: []
    })
    expect(out).not.toContain('<meeting_context>')
    expect(out).not.toContain('<screen_ocr>')
    expect(out).not.toContain('<previous_exchanges>')
  })

  it('injects reference-document text when the store has any active', () => {
    refContext.value = '\nresume snippet\n'
    const out = buildUserPrompt({
      userPrompt: 'go',
      meetingContext: '',
      contextSeconds: 60,
      segments: []
    })
    expect(out).toContain('<reference_documents>')
    expect(out).toContain('resume snippet')
  })
})
