// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { RecapTab } from './RecapTab'
import type { SessionDetailPayload } from '@shared/api'
import type { RecapPayload } from '@shared/recap-types'

// Task 14 will land the real i18n keys. For Task 11 the component already
// references them via `t(...)`, so we stub a minimal English bundle so that
// `findByRole({ name: /generate recap/i })` & friends match real English
// rather than the raw dotted key.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        translation: {
          session_detail: {
            recap: {
              empty_label: 'Recap',
              empty_blurb: 'No recap yet.',
              generate: 'Generate recap',
              regenerate: 'Regenerate',
              copy_all: 'Copy all',
              delete: 'Delete',
              delete_confirm: 'Delete recap?',
              partial_warning: 'Recap was incomplete.',
              partial_badge: 'partial',
              older_prompt: 'older prompt',
              action_items_one: '{{count}} action item',
              action_items_other: '{{count}} action items',
              decisions: 'Decisions',
              open_questions: 'Open questions',
              follow_up: 'Follow-up',
              copy_followup_md: 'Copy markdown',
              copy_followup_plain: 'Copy plain',
              error: {
                rate_limit: 'Provider rate-limited. Try again in a moment.',
                timeout: 'Recap took too long. Try a smaller model or a shorter transcript.',
                no_provider: 'No AI provider configured. Open Settings → Providers.',
                invalid_output: "Model output couldn't be parsed. Try regenerating.",
                no_transcript: 'No transcript to summarise.',
                already_generating: 'A recap is already being generated for this session.',
                unknown: 'Recap generation failed.'
              }
            }
          },
          common: { copied: 'Copied' }
        }
      }
    }
  })
}

const session: SessionDetailPayload = {
  id: 's1',
  startedAt: 0,
  endedAt: 1000,
  title: 'Test',
  segments: [{ channel: 'mic', startMs: 0, text: 'hi' }],
  exchanges: [],
  filePath: '/x'
}

function makeRecap(overrides: Partial<RecapPayload> = {}): RecapPayload {
  return {
    schemaVersion: 1,
    tldr: 'overall ok',
    decisions: ['decided x'],
    actionItems: [{ text: 'do y', owner: 'you' }],
    openQuestions: ['what z'],
    followUp: { subject: 'sub', body: 'body' },
    generatedAt: 0,
    model: 'mock',
    promptVersion: 1,
    ...overrides
  }
}

let zanban: typeof window.zanban
beforeEach(() => {
  zanban = {
    recap: {
      get: vi.fn(),
      generate: vi.fn(),
      delete: vi.fn(),
      onUpdated: vi.fn(() => () => undefined)
    }
  } as unknown as typeof window.zanban
  ;(window as { zanban: typeof window.zanban }).zanban = zanban
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('RecapTab', () => {
  it('shows empty state with generate button when no recap', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(wrap(<RecapTab session={session} />))
    await screen.findByRole('button', { name: /generate recap/i })
  })

  it('disables generate when transcript is empty', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    render(wrap(<RecapTab session={{ ...session, segments: [] }} />))
    const btn = await screen.findByRole('button', { name: /generate recap/i })
    expect(btn).toBeDisabled()
  })

  it('renders TL;DR, action items with owner chip, decisions, open questions', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecap())
    render(wrap(<RecapTab session={session} />))
    await screen.findByText('overall ok')
    expect(screen.getByText('decided x')).toBeTruthy()
    expect(screen.getByText('do y')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('what z')).toBeTruthy()
  })

  it('hides follow-up section when followUp is null', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecap({ followUp: null }))
    render(wrap(<RecapTab session={session} />))
    await screen.findByText('overall ok')
    expect(screen.queryByText(/follow-?up/i)).toBeNull()
  })

  it('shows partial badge when recap.partial is true', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeRecap({ partial: true }))
    render(wrap(<RecapTab session={session} />))
    await screen.findByText(/partial/i)
  })

  it('shows outdated badge when promptVersion mismatches', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecap({ promptVersion: 0 })
    )
    render(wrap(<RecapTab session={session} />))
    await screen.findByText(/older prompt/i)
  })

  it('calls generate on click and shows error banner on failure', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(zanban.recap.generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      code: 'rate_limit',
      message: 'Too many requests'
    })
    const { findByRole, findByText } = render(wrap(<RecapTab session={session} />))
    const btn = await findByRole('button', { name: /generate recap/i })
    btn.click()
    await findByText(/provider rate-limited/i)
  })
})
