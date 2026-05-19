# Overlay rolling transcript with inline question highlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a single-line, rolling system-channel transcript in the overlay window and highlight the currently detected question inside that line so users can see what the "Ответить" button will reply to.

**Architecture:** Pure-function `buildLane()` merges system-channel finals + the system partial + the questions store into a list of `LaneItem`s tagged `'none' | 'pending' | 'resolved'`. A thin `RollingTranscript` component reads the relevant zustand slices, renders the items into a masked horizontal lane, auto-scrolls to the tail, and shows a "listening" pulse dot. The overlay drops its bottom pending-question chip block — the inline highlight is the new "this is what Answer will reply to" signal. Visibility is gated on `session.kind === 'running'`.

**Tech Stack:** React 19 + TypeScript, Zustand 5 stores, Tailwind 4, lucide-react icons, Vitest 4 (+ happy-dom for component tests), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-19-overlay-rolling-transcript-design.md`

---

## File Structure

**Create:**

- `src/renderer/src/windows/overlay/rollingLane.ts` — pure function that builds the list of items rendered into the lane, given store inputs. No React.
- `src/renderer/src/windows/overlay/rollingLane.test.ts` — Vitest unit tests for `buildLane()`. Node env.
- `src/renderer/src/windows/overlay/RollingTranscript.tsx` — React component that subscribes to stores and renders the lane. Visibility gated to `session.kind === 'running'`.
- `src/renderer/src/windows/overlay/RollingTranscript.test.tsx` — happy-dom + RTL tests for the component. Uses zustand `setState` to drive store state.

**Modify:**

- `src/renderer/src/windows/overlay/OverlayApp.tsx` — mount `<RollingTranscript />` between `<StatusBar />` and the merged panel (inside the existing `panelRef` flex container). Remove the `pendingQuestions` chip block from the merged panel's content area. Simplify `hasContent` accordingly. Leave `decideAnswerAction` / `handleAnswer` / `markAnswered` logic alone.

No backend / IPC / main changes. No shared-types changes.

---

## Task 1: Pure `buildLane()` function (TDD)

**Files:**

- Create: `src/renderer/src/windows/overlay/rollingLane.ts`
- Create: `src/renderer/src/windows/overlay/rollingLane.test.ts`

`buildLane()` is the only place that knows how segments and questions combine. Component renders whatever it returns.

- [ ] **Step 1: Write the failing test file**

Create `src/renderer/src/windows/overlay/rollingLane.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TranscriptSegment } from '@shared/types'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
import { buildLane } from './rollingLane'

const seg = (
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system',
  isFinal = true
): TranscriptSegment => ({
  id,
  channel,
  text,
  isFinal,
  createdAt: 0
})

const q = (
  id: string,
  text: string,
  status: DetectedQuestion['status'] = 'pending'
): DetectedQuestion => ({
  id,
  text,
  detectedAt: 0,
  status
})

describe('buildLane', () => {
  it('returns empty lane for empty inputs', () => {
    expect(
      buildLane({
        finals: [],
        partial: null,
        questions: [],
        autoDetectQuestions: true
      })
    ).toEqual([])
  })

  it('maps finals to non-highlighted items by default', () => {
    const out = buildLane({
      finals: [seg('a', 'one'), seg('b', 'two')],
      partial: null,
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toEqual([
      { id: 'a', text: 'one', isFinal: true, highlight: 'none' },
      { id: 'b', text: 'two', isFinal: true, highlight: 'none' }
    ])
  })

  it('marks a final as pending when a matching question is pending', () => {
    const out = buildLane({
      finals: [seg('a', 'tell me about react?')],
      partial: null,
      questions: [q('a', 'tell me about react?', 'pending')],
      autoDetectQuestions: true
    })
    expect(out[0].highlight).toBe('pending')
  })

  it('marks a final as resolved when the matching question is answered', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'answered')],
      autoDetectQuestions: true
    })
    expect(out[0].highlight).toBe('resolved')
  })

  it('marks a final as resolved when the matching question is dismissed', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'dismissed')],
      autoDetectQuestions: true
    })
    expect(out[0].highlight).toBe('resolved')
  })

  it('ignores question store entirely when autoDetectQuestions is false', () => {
    const out = buildLane({
      finals: [seg('a', 'q?')],
      partial: null,
      questions: [q('a', 'q?', 'pending')],
      autoDetectQuestions: false
    })
    expect(out[0].highlight).toBe('none')
  })

  it('appends a non-final tail item for a non-empty partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', 'still going', 'system', false),
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({
      id: 'p1-p',
      text: 'still going',
      isFinal: false,
      highlight: 'none'
    })
  })

  it('drops a whitespace-only partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', '   ', 'system', false),
      questions: [],
      autoDetectQuestions: true
    })
    expect(out).toHaveLength(1)
  })

  it('truncates to the last `limit` finals but always keeps the partial', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({
      finals,
      partial: seg('p', 'tail', 'system', false),
      questions: [],
      autoDetectQuestions: true,
      limit: 3
    })
    expect(out.map((x) => x.id)).toEqual(['f7', 'f8', 'f9', 'p-p'])
  })

  it('only highlights segments whose ids match a question', () => {
    const out = buildLane({
      finals: [seg('a', 'no match'), seg('b', 'has match')],
      partial: null,
      questions: [q('b', 'has match', 'pending')],
      autoDetectQuestions: true
    })
    expect(out[0].highlight).toBe('none')
    expect(out[1].highlight).toBe('pending')
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm test -- rollingLane`
Expected: all tests fail with `Cannot find module './rollingLane'` or similar — the implementation file does not exist yet.

- [ ] **Step 3: Implement `buildLane()`**

Create `src/renderer/src/windows/overlay/rollingLane.ts`:

```ts
import type { TranscriptSegment } from '@shared/types'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'

export interface LaneItem {
  id: string
  text: string
  isFinal: boolean
  highlight: 'none' | 'pending' | 'resolved'
}

export interface BuildLaneArgs {
  /** System-channel finals, in chronological order. Caller filters by channel. */
  finals: TranscriptSegment[]
  /** Current system-channel partial, or null. */
  partial: TranscriptSegment | null
  questions: DetectedQuestion[]
  /** When false, the questions store is ignored — every item is 'none'. */
  autoDetectQuestions: boolean
  /** Last N finals to keep; older finals are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

export function buildLane({
  finals,
  partial,
  questions,
  autoDetectQuestions,
  limit = DEFAULT_LIMIT
}: BuildLaneArgs): LaneItem[] {
  const byId = new Map<string, DetectedQuestion>()
  if (autoDetectQuestions) {
    for (const q of questions) byId.set(q.id, q)
  }

  const tail = finals.slice(-limit)
  const out: LaneItem[] = tail.map((seg) => {
    const matched = byId.get(seg.id)
    let highlight: LaneItem['highlight'] = 'none'
    if (matched) {
      highlight = matched.status === 'pending' ? 'pending' : 'resolved'
    }
    return { id: seg.id, text: seg.text, isFinal: true, highlight }
  })

  if (partial && partial.text.trim().length > 0) {
    out.push({
      id: `${partial.id}-p`,
      text: partial.text,
      isFinal: false,
      highlight: 'none'
    })
  }

  return out
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm test -- rollingLane`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/windows/overlay/rollingLane.ts src/renderer/src/windows/overlay/rollingLane.test.ts
git commit -m "feat(overlay): buildLane pure function for rolling transcript items"
```

---

## Task 2: `RollingTranscript` component (TDD with happy-dom)

**Files:**

- Create: `src/renderer/src/windows/overlay/RollingTranscript.tsx`
- Create: `src/renderer/src/windows/overlay/RollingTranscript.test.tsx`

The component is intentionally thin: store selectors → `buildLane()` → render. Tests drive store state directly via zustand `setState`, the same pattern the existing stores expose.

- [ ] **Step 1: Write the failing test file**

Create `src/renderer/src/windows/overlay/RollingTranscript.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { TranscriptSegment } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { useQuestions } from '@renderer/features/transcript/questionsStore'
import { useSettingsStore } from '@renderer/features/settings/store'
import { RollingTranscript } from './RollingTranscript'

function fSeg(
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment {
  return { id, text, channel, isFinal: true, createdAt: 0 }
}

beforeEach(() => {
  useTranscript.setState({
    finals: [],
    partials: { mic: null, system: null },
    session: { kind: 'idle' },
    status: { mic: null, system: null },
    lastUpdateAt: null,
    lastFinalAt: null
  })
  useQuestions.setState({ questions: [] })
  useSettingsStore.setState({ settings: null, ready: true, loading: false } as never)
})

function makeRunning(): void {
  useTranscript.setState({
    session: { kind: 'running', sessionId: 's1', startedAt: 0 }
  })
}

describe('RollingTranscript', () => {
  it('renders nothing when session is idle', () => {
    const { queryByTestId } = render(<RollingTranscript />)
    expect(queryByTestId('overlay-rolling-transcript')).toBeNull()
  })

  it('renders the pill when session is running', () => {
    makeRunning()
    const { getByTestId } = render(<RollingTranscript />)
    expect(getByTestId('overlay-rolling-transcript')).toBeTruthy()
  })

  it('renders only system-channel finals', () => {
    makeRunning()
    useTranscript.setState({
      finals: [fSeg('m1', 'mic-line', 'mic'), fSeg('s1', 'system-line', 'system')]
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('system-line')
    expect(el.textContent).not.toContain('mic-line')
  })

  it('highlights a segment whose id matches a pending question', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'tell me about react?', 'system')] })
    useQuestions.setState({
      questions: [
        {
          id: 's1',
          text: 'tell me about react?',
          detectedAt: 0,
          status: 'pending'
        }
      ]
    })
    useSettingsStore.setState({
      settings: { autoDetectQuestions: true } as never,
      ready: true,
      loading: false
    } as never)
    const { container } = render(<RollingTranscript />)
    const highlighted = container.querySelector('[data-highlight="pending"]')
    expect(highlighted?.textContent).toBe('tell me about react?')
  })

  it('dims the highlight after the question is marked answered', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'q?', 'system')] })
    useQuestions.setState({
      questions: [{ id: 's1', text: 'q?', detectedAt: 0, status: 'answered' }]
    })
    useSettingsStore.setState({
      settings: { autoDetectQuestions: true } as never,
      ready: true,
      loading: false
    } as never)
    const { container } = render(<RollingTranscript />)
    expect(container.querySelector('[data-highlight="pending"]')).toBeNull()
    expect(container.querySelector('[data-highlight="resolved"]')?.textContent).toBe('q?')
  })

  it('does not highlight when autoDetectQuestions is false', () => {
    makeRunning()
    useTranscript.setState({ finals: [fSeg('s1', 'q?', 'system')] })
    useQuestions.setState({
      questions: [{ id: 's1', text: 'q?', detectedAt: 0, status: 'pending' }]
    })
    useSettingsStore.setState({
      settings: { autoDetectQuestions: false } as never,
      ready: true,
      loading: false
    } as never)
    const { container } = render(<RollingTranscript />)
    expect(container.querySelector('[data-highlight="pending"]')).toBeNull()
    expect(container.querySelector('[data-highlight="resolved"]')).toBeNull()
  })

  it('shows partial system text in the tail with the cursor glyph', () => {
    makeRunning()
    useTranscript.setState({
      partials: {
        mic: null,
        system: { id: 'p1', text: 'still talking', channel: 'system', isFinal: false, createdAt: 0 }
      }
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('still talking')
    expect(el.textContent).toContain('▍')
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm test -- RollingTranscript`
Expected: all tests fail with module-not-found for `./RollingTranscript`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/src/windows/overlay/RollingTranscript.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { Ear } from 'lucide-react'
import { useTranscript } from '@renderer/features/transcript/store'
import { useQuestions } from '@renderer/features/transcript/questionsStore'
import { useSettingsStore } from '@renderer/features/settings/store'
import { cn } from '@renderer/lib/utils'
import { buildLane, type LaneItem } from './rollingLane'

const SYSTEM_LIMIT = 40

export function RollingTranscript(): JSX.Element | null {
  const session = useTranscript((s) => s.session)
  const finals = useTranscript((s) => s.finals)
  const partial = useTranscript((s) => s.partials.system)
  const questions = useQuestions((s) => s.questions)
  const autoDetect = useSettingsStore((s) => s.settings?.autoDetectQuestions)

  const systemFinals = useMemo(() => finals.filter((f) => f.channel === 'system'), [finals])

  const lane = useMemo(
    () =>
      buildLane({
        finals: systemFinals,
        partial,
        questions,
        autoDetectQuestions: autoDetect !== false,
        limit: SYSTEM_LIMIT
      }),
    [systemFinals, partial, questions, autoDetect]
  )

  // Auto-scroll the lane to its right edge whenever content grows. Single-line
  // strip with no need for "stick to bottom" behavior — there's no manual
  // exploration mode in this first version.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const signature = lane.map((l) => `${l.id}:${l.text.length}`).join('|')
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
  }, [signature])

  if (session.kind !== 'running') return null

  return (
    <div
      data-interactive
      data-testid="overlay-rolling-transcript"
      className={cn(
        'mx-auto flex w-full max-w-[680px] items-center gap-2',
        'rounded-full border border-white/10',
        'bg-black/55 px-3 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl'
      )}
    >
      <Ear className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <div
        ref={scrollerRef}
        className="flex-1 min-w-0 overflow-x-hidden whitespace-nowrap text-[12px] leading-6 italic"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'
        }}
      >
        {lane.length === 0 ? (
          <span className="text-muted-foreground/60">listening…</span>
        ) : (
          lane.map((item, idx) => (
            <span key={item.id}>
              {idx > 0 && (
                <span className="px-1 text-muted-foreground/30" aria-hidden>
                  ·
                </span>
              )}
              <SegmentSpan item={item} />
            </span>
          ))
        )}
      </div>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-emerald-400/70 motion-safe:animate-pulse"
      />
    </div>
  )
}

function SegmentSpan({ item }: { item: LaneItem }): JSX.Element {
  if (!item.isFinal) {
    return (
      <span className="text-muted-foreground/70">
        {item.text}
        <span className="text-muted-foreground/60">▍</span>
      </span>
    )
  }
  if (item.highlight === 'pending') {
    return (
      <span data-highlight="pending" className="text-primary">
        {item.text}
      </span>
    )
  }
  if (item.highlight === 'resolved') {
    return (
      <span data-highlight="resolved" className="text-foreground/45">
        {item.text}
      </span>
    )
  }
  return <span className="text-foreground/85">{item.text}</span>
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm test -- RollingTranscript`
Expected: all 7 tests pass.

If a test fails because `useSettingsStore`'s shape differs from the cast above, open `src/renderer/src/features/settings/store.ts` and adjust the `setState` payload in `beforeEach` and the failing test to match the actual state shape (do NOT add a `as never` cast to production code — keep it test-local).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/windows/overlay/RollingTranscript.tsx src/renderer/src/windows/overlay/RollingTranscript.test.tsx
git commit -m "feat(overlay): RollingTranscript component with inline question highlight"
```

---

## Task 3: Wire `RollingTranscript` into `OverlayApp` and drop the bottom chip block

**Files:**

- Modify: `src/renderer/src/windows/overlay/OverlayApp.tsx`

Two changes only:

1. Import `RollingTranscript` and mount it between `<StatusBar />` and the merged panel.
2. Delete the `pendingQuestions` chip block from the merged panel and simplify `hasContent`.

- [ ] **Step 1: Add the import**

In `src/renderer/src/windows/overlay/OverlayApp.tsx`, find the existing import line:

```ts
import { decideAnswerAction } from './handleAnswer'
```

Insert directly below it:

```ts
import { RollingTranscript } from './RollingTranscript'
```

- [ ] **Step 2: Mount `<RollingTranscript />` between `<StatusBar />` and the merged panel**

Locate the JSX block that renders `<StatusBar ... />` followed by the merged-panel `<div className={cn('flex flex-col rounded-2xl border border-white/10', ...)}>`.

Replace this section:

```tsx
<StatusBar
  running={running}
  busy={busy}
  elapsed={elapsed}
  stealth={stealth}
  onStop={() => void stopSession()}
  onToggleStealth={() => void toggleStealth()}
  onClose={() => void backToDashboard()}
  onOpenDashboard={() => void openDashboardKeepSession()}
/>

{/* Merged panel: chips → input → answer in ONE container. Per UX
```

With:

```tsx
<StatusBar
  running={running}
  busy={busy}
  elapsed={elapsed}
  stealth={stealth}
  onStop={() => void stopSession()}
  onToggleStealth={() => void toggleStealth()}
  onClose={() => void backToDashboard()}
  onOpenDashboard={() => void openDashboardKeepSession()}
/>

<RollingTranscript />

{/* Merged panel: chips → input → answer in ONE container. Per UX
```

- [ ] **Step 3: Remove the bottom `pendingQuestions` chip block**

Inside the merged panel's `{hasContent && (...)}` JSX, locate and delete this entire block:

```tsx
{pendingQuestions.length > 0 && settings?.autoDetectQuestions !== false && (
  <div className="flex flex-wrap gap-1.5">
    {pendingQuestions.map((q) => (
      <button
        key={q.id}
        data-interactive
        onClick={() => {
          useQuestions.getState().markAnswered(q.id)
          void runPrompt(q.text)
        }}
        className={cn(
          'group inline-flex max-w-[420px] items-center gap-1.5 rounded-md',
          'border border-primary/40 bg-primary/10 px-2 py-1',
          'text-[11px] text-foreground transition-colors',
          'hover:bg-primary/20 hover:border-primary/60'
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="truncate">{q.text}</span>
        <span className="ml-1 shrink-0 rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-primary">
          {t('overlay.answer_pill')}
        </span>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Simplify `hasContent` and drop now-unused `pendingQuestions`**

Find this block:

```ts
const allQuestions = useQuestions((s) => s.questions)
```

Delete it (the chip block was its only consumer).

Find:

```ts
const pendingQuestions = useMemo(
  () => allQuestions.filter((q) => q.status === 'pending').slice(-2),
  [allQuestions]
)
```

Delete it.

Find:

```ts
const hasContent =
  hasHistory ||
  apiKeysMissing ||
  transcriptionError ||
  (pendingQuestions.length > 0 && settings?.autoDetectQuestions !== false)
```

Replace with:

```ts
const hasContent = hasHistory || apiKeysMissing || transcriptionError
```

- [ ] **Step 5: Drop now-unused imports**

At the top of the file, find:

```ts
import { useQuestions } from '@renderer/features/transcript/questionsStore'
```

This import is still needed inside `handleAnswer` (via `useQuestions.getState().questions` and `useQuestions.getState().markAnswered(...)`). Verify it is still referenced; if those references remain (they should — `handleAnswer` reads the store imperatively), **leave the import in place**.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS — no `TS2304` ("cannot find name") for `pendingQuestions` or `allQuestions`, no unused-import errors.

Run: `pnpm lint`
Expected: PASS — no `@typescript-eslint/no-unused-vars` for the variables just removed.

If lint reports `'useMemo'` as unused (it was only consumed by `pendingQuestions`), check the file — `useMemo` is also used elsewhere via the `historyRef` block. If indeed unused now, remove it from the `react` import.

- [ ] **Step 7: Run the overlay test suite to confirm nothing else broke**

Run: `pnpm test -- src/renderer/src/windows/overlay`
Expected: every existing overlay test still passes, plus the two new files added in Tasks 1 and 2.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/windows/overlay/OverlayApp.tsx
git commit -m "feat(overlay): mount RollingTranscript, drop bottom pending-question chip"
```

---

## Task 4: Full verification pass

**Files:** none — verification only.

- [ ] **Step 1: Full test run**

Run: `pnpm test`
Expected: PASS for the entire suite.

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS for both `tsconfig.node.json` and `tsconfig.web.json`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Smoke-test in dev**

Run: `pnpm dev` (electron-vite dev). With the app up:

1. Start a session from the dashboard so the overlay receives `session.kind === 'running'`.
2. Verify the rolling pill appears between the status strip and the main panel.
3. Speak into the system-audio source (or play a recording into it) and confirm:
   - The text scrolls into view from the right with `· ` between finals.
   - A question-like utterance gets primary-colored once the LLM extractor finishes (a beat after the final).
   - Pressing **Ответить** dims that segment to `text-foreground/45`.
   - Starting to answer with your mic auto-dims the latest pending segment (via the existing `markAnswered` rule in `store.ts:71-78`).
4. Confirm the old bottom chip is gone.
5. Stop the session and confirm the pill disappears entirely.

If anything visually misbehaves (clipped text, wrong height, overlay shaved at the bottom), the `ResizeObserver` in `useLayoutEffect` should catch it — but check the OS window height in dev tools to be sure.

- [ ] **Step 5: Final commit (only if smoke testing surfaced trivial polish)**

If the smoke test required no code changes, skip this step. Otherwise:

```bash
git add -p   # stage only the polish hunks
git commit -m "fix(overlay): <one-line polish from smoke test>"
```

---

## Self-Review Notes

- Spec coverage:
  - "Source = system finals + system partial" → Task 1 (`buildLane`), Task 2 (component filters `finals.filter(channel==='system')`).
  - "Highlight pending = primary, resolved = muted" → Task 1 mapping; Task 2 `SegmentSpan`.
  - "Hide when not running" → Task 2 `if (session.kind !== 'running') return null`.
  - "Drop bottom chip block" → Task 3, Steps 3–4.
  - "Old `decideAnswerAction` / `markAnswered` untouched" → Task 3 leaves them alone; verified by Step 7 (existing tests stay green).
  - "ResizeObserver auto-grow" → relies on the existing `panelRef` parent that wraps StatusBar + RollingTranscript + merged panel; no structural change needed.
  - "Tests: `rollingLane.test.ts`, `RollingTranscript.test.tsx`" → Tasks 1, 2.

- No placeholders: every code step has the full code; every command has expected output.

- Type consistency: `LaneItem`, `BuildLaneArgs`, and the test `seg`/`q` helpers all match `TranscriptSegment` and `DetectedQuestion` exactly. `useSettingsStore.setState({...})` in Task 2 step 1 has a `as never` escape hatch — left intentionally for test brevity, with a note in step 4 about adjusting if the real shape differs.
