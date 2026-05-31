import { describe, expect, it } from 'vitest'
import { insertRecapSection, renderRecapMarkdown } from './recapMarkdown.js'
import type { RecapCore } from './recapSchema.js'

const full: RecapCore = {
  tldr: 'We aligned on the launch plan.',
  decisions: ['Ship on Friday', 'Skip the beta'],
  actionItems: [
    { text: 'Write release notes', owner: 'you', dueHint: 'Thu' },
    { text: 'Approve copy', owner: 'them' },
    { text: 'Book the room', owner: 'unknown' }
  ],
  openQuestions: ['Who owns the rollback?'],
  followUp: { subject: 'Launch recap', body: 'Thanks all — here are next steps.' }
}

describe('renderRecapMarkdown', () => {
  it('renders every section with an H2 root and H3 subsections', () => {
    const md = renderRecapMarkdown(full)
    expect(md).toContain('## Recap')
    expect(md).toContain('### TL;DR')
    expect(md).toContain('We aligned on the launch plan.')
    expect(md).toContain('### Action items')
    expect(md).toContain('- (You) Write release notes — Thu')
    expect(md).toContain('- (Them) Approve copy')
    expect(md).toContain('- (?) Book the room')
    expect(md).toContain('### Decisions')
    expect(md).toContain('- Ship on Friday')
    expect(md).toContain('### Open questions')
    expect(md).toContain('- Who owns the rollback?')
    expect(md).toContain('### Follow-up')
    expect(md).toContain('**Subject:** Launch recap')
    expect(md).toContain('Thanks all — here are next steps.')
  })

  it('omits empty sections and a null follow-up', () => {
    const md = renderRecapMarkdown({
      tldr: 'Quick sync.',
      decisions: [],
      actionItems: [],
      openQuestions: [],
      followUp: null
    })
    expect(md).toContain('### TL;DR')
    expect(md).not.toContain('### Action items')
    expect(md).not.toContain('### Decisions')
    expect(md).not.toContain('### Open questions')
    expect(md).not.toContain('### Follow-up')
  })
})

describe('insertRecapSection', () => {
  const sessionMd = `---
id: abc
---

# My meeting

## Transcript

- \`00:01\` **You** — hello
`

  it('inserts the recap block immediately before the transcript heading', () => {
    const out = insertRecapSection(sessionMd, '## Recap\n\n### TL;DR\n\nsummary\n')
    const recapIdx = out.indexOf('## Recap')
    const transcriptIdx = out.indexOf('## Transcript')
    expect(recapIdx).toBeGreaterThan(-1)
    expect(transcriptIdx).toBeGreaterThan(-1)
    expect(recapIdx).toBeLessThan(transcriptIdx)
    // H1 title still precedes the recap.
    expect(out.indexOf('# My meeting')).toBeLessThan(recapIdx)
  })

  it('appends the recap when there is no transcript heading', () => {
    const out = insertRecapSection('# Just a title\n', '## Recap\n\nsummary')
    expect(out.endsWith('## Recap\n\nsummary')).toBe(true)
    expect(out.indexOf('# Just a title')).toBeLessThan(out.indexOf('## Recap'))
  })
})
