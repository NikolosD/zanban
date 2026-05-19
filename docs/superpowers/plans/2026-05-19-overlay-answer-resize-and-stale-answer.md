# Overlay answer resize + stale-answer fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a draggable height handle for the overlay answer pane, persist their choice, and make the "Ответить" chip always answer the latest detected question instead of the previous one.

**Architecture:** A new `<AnswerPaneResizer>` component replaces the static `max-h` clamp on the history div. Drag state lives in `OverlayApp`, persists via `window.zanban.settings.set({ overlayAnswerMaxHeight })`. The stale-answer fix routes `onAnswer` through a new `handleAnswer()` helper that prefers `useQuestions.getState().questions.at(-1) // pending` over the LLM re-deriving the question from a stale transcript buffer.

**Tech Stack:** React 19, Zustand, Tailwind 4, Vitest + happy-dom + @testing-library/react, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-05-19-overlay-answer-resize-and-stale-answer-design.md`

---

## File Structure

**Create:**
- `src/renderer/src/windows/overlay/AnswerPaneResizer.tsx` — the drag-handle UI + drag logic (mousedown/move/up, dblclick reset, clamp math).
- `src/renderer/src/windows/overlay/answerPaneResize.ts` — pure clamp/hardCap helpers, easily unit-tested without DOM.
- `src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx` — DOM test for drag interaction + dblclick.
- `src/renderer/src/windows/overlay/answerPaneResize.test.ts` — unit tests for clamp/hardCap math.
- `src/renderer/src/windows/overlay/handleAnswer.ts` — pure decision helper (pending question → use its text; else → fallback).
- `src/renderer/src/windows/overlay/handleAnswer.test.ts` — unit tests for the branching logic.

**Modify:**
- `src/shared/types.ts` — add `overlayAnswerMaxHeight: number` to `AppSettings`; default `320` in `DEFAULT_SETTINGS`.
- `src/renderer/src/windows/overlay/OverlayApp.tsx`
  - replace `max-h-[clamp(...)]` className on history pane with `style={{ maxHeight }}`
  - render `<AnswerPaneResizer>` between history and `InputPill`
  - call `handleAnswer()` from the chip `onAnswer` and the IPC `onAnswerLast` listener

---

## Task 1: Settings field

**Files:**
- Modify: `src/shared/types.ts:153-300` (interface) and `:478-523` (DEFAULT_SETTINGS)

- [ ] **Step 1: Add the field to `AppSettings`**

Open `src/shared/types.ts`. Find the `autoDetectQuestions: boolean` line (around line 260). Add immediately after it:

```ts
  /**
   * Max height in CSS pixels of the overlay's answer-history scroll area.
   * The user sets this by dragging the resize handle below the answer list.
   * Persisted so each new session opens at the user's preferred ceiling.
   */
  overlayAnswerMaxHeight: number
```

- [ ] **Step 2: Add the default**

Find `DEFAULT_SETTINGS` (around line 478). Find the `autoDetectQuestions: true,` line. Add immediately after it:

```ts
  overlayAnswerMaxHeight: 320,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. No new errors. (Existing settings consumers don't read this field yet, so adding it is safe.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(settings): add overlayAnswerMaxHeight"
```

---

## Task 2: Resize math helper (pure, no DOM)

**Files:**
- Create: `src/renderer/src/windows/overlay/answerPaneResize.ts`
- Test: `src/renderer/src/windows/overlay/answerPaneResize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/windows/overlay/answerPaneResize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ANSWER_MAX_HEIGHT,
  MIN_ANSWER_MAX_HEIGHT,
  ABSOLUTE_MAX_ANSWER_HEIGHT,
  computeHardCap,
  clampAnswerHeight
} from './answerPaneResize'

describe('answerPaneResize', () => {
  it('exposes the constants the UI relies on', () => {
    expect(DEFAULT_ANSWER_MAX_HEIGHT).toBe(320)
    expect(MIN_ANSWER_MAX_HEIGHT).toBe(200)
    expect(ABSOLUTE_MAX_ANSWER_HEIGHT).toBe(720)
  })

  it('computeHardCap subtracts 200 from availHeight and caps at 720', () => {
    expect(computeHardCap(1080)).toBe(720) // 1080-200=880 → capped to 720
    expect(computeHardCap(900)).toBe(700) // 900-200=700, under cap
    expect(computeHardCap(500)).toBe(300) // small monitor
  })

  it('computeHardCap never drops below MIN', () => {
    // Very small reported availHeight (degenerate / mocked screen)
    expect(computeHardCap(100)).toBe(MIN_ANSWER_MAX_HEIGHT)
  })

  it('clampAnswerHeight respects MIN and the runtime cap', () => {
    expect(clampAnswerHeight(50, 700)).toBe(MIN_ANSWER_MAX_HEIGHT)
    expect(clampAnswerHeight(400, 700)).toBe(400)
    expect(clampAnswerHeight(900, 700)).toBe(700)
  })
})
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test src/renderer/src/windows/overlay/answerPaneResize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/src/windows/overlay/answerPaneResize.ts`:

```ts
/**
 * Pure helpers for the answer-pane resize handle. Kept DOM-free so the math
 * is trivially unit-testable.
 */

export const DEFAULT_ANSWER_MAX_HEIGHT = 320
export const MIN_ANSWER_MAX_HEIGHT = 200
export const ABSOLUTE_MAX_ANSWER_HEIGHT = 720

/**
 * Largest height the answer pane is allowed to take on the current display.
 * Reserves ~200px for status bar, chips row, and input pill, then caps at
 * 720px so the overlay never dominates the screen even on tall monitors.
 *
 * If the computed cap would fall below MIN (degenerate monitors / mocked
 * screen in tests) we clamp up to MIN so the UI is still usable.
 */
export function computeHardCap(availHeight: number): number {
  const headroom = availHeight - 200
  const capped = Math.min(headroom, ABSOLUTE_MAX_ANSWER_HEIGHT)
  return Math.max(MIN_ANSWER_MAX_HEIGHT, capped)
}

/**
 * Apply both the floor (MIN) and the runtime ceiling (hardCap).
 */
export function clampAnswerHeight(requested: number, hardCap: number): number {
  if (requested < MIN_ANSWER_MAX_HEIGHT) return MIN_ANSWER_MAX_HEIGHT
  if (requested > hardCap) return hardCap
  return requested
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm test src/renderer/src/windows/overlay/answerPaneResize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/windows/overlay/answerPaneResize.ts src/renderer/src/windows/overlay/answerPaneResize.test.ts
git commit -m "feat(overlay): clamp + hardCap helpers for answer pane resize"
```

---

## Task 3: AnswerPaneResizer component

**Files:**
- Create: `src/renderer/src/windows/overlay/AnswerPaneResizer.tsx`
- Test: `src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx`

- [ ] **Step 1: Write the failing DOM tests**

Create `src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AnswerPaneResizer } from './AnswerPaneResizer'
import { DEFAULT_ANSWER_MAX_HEIGHT, MIN_ANSWER_MAX_HEIGHT } from './answerPaneResize'

function renderResizer(overrides: { value?: number; hardCap?: number } = {}) {
  const onChange = vi.fn<(n: number) => void>()
  const onCommit = vi.fn<(n: number) => void>()
  const utils = render(
    <AnswerPaneResizer
      value={overrides.value ?? DEFAULT_ANSWER_MAX_HEIGHT}
      hardCap={overrides.hardCap ?? 700}
      onChange={onChange}
      onCommit={onCommit}
    />
  )
  const handle = utils.container.querySelector('[data-testid="answer-pane-resizer"]') as HTMLElement
  return { ...utils, onChange, onCommit, handle }
}

describe('AnswerPaneResizer', () => {
  it('renders a draggable handle with ns-resize cursor', () => {
    const { handle } = renderResizer()
    expect(handle).toBeTruthy()
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('drag down increases the value and calls onChange live', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 320 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 150 }) // +50px
    expect(onChange).toHaveBeenLastCalledWith(370)
    expect(onCommit).not.toHaveBeenCalled() // not yet
    fireEvent.mouseUp(document)
    expect(onCommit).toHaveBeenCalledWith(370)
  })

  it('drag up decreases value but never below MIN', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 220 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 50 }) // -50 → would be 170
    expect(onChange).toHaveBeenLastCalledWith(MIN_ANSWER_MAX_HEIGHT)
    fireEvent.mouseUp(document)
    expect(onCommit).toHaveBeenCalledWith(MIN_ANSWER_MAX_HEIGHT)
  })

  it('drag respects hardCap', () => {
    const { handle, onChange } = renderResizer({ value: 600, hardCap: 700 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 300 }) // +200 → would be 800
    expect(onChange).toHaveBeenLastCalledWith(700)
  })

  it('does not call onCommit if the value did not actually change', () => {
    const { handle, onCommit } = renderResizer({ value: 320 })
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseUp(document) // no move
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('double-click resets to default and commits', () => {
    const { handle, onChange, onCommit } = renderResizer({ value: 500 })
    fireEvent.doubleClick(handle)
    expect(onChange).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
    expect(onCommit).toHaveBeenCalledWith(DEFAULT_ANSWER_MAX_HEIGHT)
  })

  it('cleans up document listeners after mouseup so further moves do not fire', () => {
    const { handle, onChange } = renderResizer()
    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseUp(document)
    onChange.mockClear()
    fireEvent.mouseMove(document, { clientY: 500 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm test src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/renderer/src/windows/overlay/AnswerPaneResizer.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { DEFAULT_ANSWER_MAX_HEIGHT, clampAnswerHeight } from './answerPaneResize'

interface Props {
  /** Current max-height in px. Controlled. */
  value: number
  /** Runtime ceiling derived from screen.availHeight. */
  hardCap: number
  /** Fires live during drag with the proposed new height (already clamped). */
  onChange: (next: number) => void
  /** Fires once on mouseup / dblclick if the value actually changed during the gesture. */
  onCommit: (next: number) => void
}

/**
 * Thin horizontal grip between the answer history list and the input pill.
 * Dragging moves the inner scroll area's max-height. Double-click resets to
 * DEFAULT_ANSWER_MAX_HEIGHT. The OS window itself follows via the existing
 * ResizeObserver in OverlayApp.
 */
export function AnswerPaneResizer({ value, hardCap, onChange, onCommit }: Props) {
  // Capture the starting state at mousedown so each drag is computed relative
  // to where the gesture began — not the most recent intermediate value, which
  // would compound rounding errors.
  const startY = useRef<number | null>(null)
  const startValue = useRef<number>(value)
  const latestValue = useRef<number>(value)

  // Keep latestValue in sync with the prop so the mouseup commit sees the
  // value that was most recently emitted via onChange (parent has already
  // applied it back to `value` by the next render, but during a fast drag
  // we need it immediately).
  useEffect(() => {
    latestValue.current = value
  }, [value])

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (startY.current === null) return
      const delta = e.clientY - startY.current
      const next = clampAnswerHeight(startValue.current + delta, hardCap)
      latestValue.current = next
      onChange(next)
    },
    [hardCap, onChange]
  )

  const endDrag = useCallback(() => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', endDrag)
    if (startY.current === null) return
    const committed = latestValue.current
    const started = startValue.current
    startY.current = null
    if (committed !== started) onCommit(committed)
  }, [onMove, onCommit])

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startY.current = e.clientY
    startValue.current = value
    latestValue.current = value
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', endDrag)
  }

  const onDoubleClick = () => {
    if (value === DEFAULT_ANSWER_MAX_HEIGHT) return
    onChange(DEFAULT_ANSWER_MAX_HEIGHT)
    onCommit(DEFAULT_ANSWER_MAX_HEIGHT)
  }

  // Safety: detach on unmount in case the user navigated away mid-drag.
  useEffect(
    () => () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', endDrag)
    },
    [onMove, endDrag]
  )

  return (
    <div
      data-testid="answer-pane-resizer"
      data-interactive
      role="separator"
      aria-orientation="horizontal"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{ cursor: 'ns-resize', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className={cn(
        'h-1.5 w-full shrink-0 bg-white/5 transition-colors',
        'hover:bg-white/15 active:bg-white/25'
      )}
    />
  )
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm test src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/windows/overlay/AnswerPaneResizer.tsx src/renderer/src/windows/overlay/AnswerPaneResizer.test.tsx
git commit -m "feat(overlay): AnswerPaneResizer drag handle"
```

---

## Task 4: handleAnswer decision helper

**Files:**
- Create: `src/renderer/src/windows/overlay/handleAnswer.ts`
- Test: `src/renderer/src/windows/overlay/handleAnswer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/windows/overlay/handleAnswer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { decideAnswerAction } from './handleAnswer'
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'

const q = (id: string, text: string, status: DetectedQuestion['status'] = 'pending'): DetectedQuestion => ({
  id,
  text,
  detectedAt: Date.now(),
  status
})

describe('decideAnswerAction', () => {
  it('returns "fallback" when autoDetectQuestions is false', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'What is React?')],
      autoDetectQuestions: false
    })
    expect(action).toEqual({ kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true })
  })

  it('returns "fallback" when there are no pending questions', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'old?', 'answered'), q('2', 'dropped?', 'dismissed')],
      autoDetectQuestions: true
    })
    expect(action).toEqual({ kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true })
  })

  it('returns "fallback" on empty store', () => {
    const action = decideAnswerAction({ questions: [], autoDetectQuestions: true })
    expect(action.kind).toBe('fallback')
  })

  it('returns "answerDetected" with the latest pending question', () => {
    const action = decideAnswerAction({
      questions: [
        q('1', 'first?'),
        q('2', 'second?', 'answered'),
        q('3', 'third?'),
        q('4', 'latest?')
      ],
      autoDetectQuestions: true
    })
    expect(action).toEqual({
      kind: 'answerDetected',
      questionId: '4',
      questionText: 'latest?'
    })
  })

  it('treats undefined autoDetectQuestions as enabled (default)', () => {
    const action = decideAnswerAction({
      questions: [q('1', 'go?')],
      autoDetectQuestions: undefined
    })
    expect(action.kind).toBe('answerDetected')
  })
})
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm test src/renderer/src/windows/overlay/handleAnswer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/src/windows/overlay/handleAnswer.ts`:

```ts
import type { DetectedQuestion } from '@renderer/features/transcript/questionsStore'
import { ANSWER_LAST_PROMPT } from '@shared/prompts'

export type AnswerAction =
  | { kind: 'answerDetected'; questionId: string; questionText: string }
  | { kind: 'fallback'; prompt: string; waitForTranscript: boolean }

interface Input {
  questions: DetectedQuestion[]
  /** Settings flag; `undefined` is treated as enabled (matches the existing default). */
  autoDetectQuestions: boolean | undefined
}

/**
 * Decide what the "Ответить" button should actually do.
 *
 * Default flow ("answer last") used to ship the raw ANSWER_LAST_PROMPT and let
 * the LLM figure out the question from the transcript tail. That tail is often
 * stale at click time (STT has not flushed the final segment yet), so the
 * first click ends up answering the *previous* question. Routing through the
 * detected-questions store gives us the verbatim question text the moment the
 * extractor emitted it, which is far ahead of `awaitTranscriptSettle`.
 *
 * When the detector is disabled or no pending question is in the store, we
 * fall through to the legacy prompt so users who turned off detection are not
 * silently broken.
 */
export function decideAnswerAction({ questions, autoDetectQuestions }: Input): AnswerAction {
  if (autoDetectQuestions === false) {
    return { kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true }
  }
  const latestPending = questions.filter((q) => q.status === 'pending').at(-1)
  if (!latestPending) {
    return { kind: 'fallback', prompt: ANSWER_LAST_PROMPT, waitForTranscript: true }
  }
  return {
    kind: 'answerDetected',
    questionId: latestPending.id,
    questionText: latestPending.text
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm test src/renderer/src/windows/overlay/handleAnswer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/windows/overlay/handleAnswer.ts src/renderer/src/windows/overlay/handleAnswer.test.ts
git commit -m "feat(overlay): decideAnswerAction routes to detected question first"
```

---

## Task 5: Wire resizer into OverlayApp

**Files:**
- Modify: `src/renderer/src/windows/overlay/OverlayApp.tsx`

- [ ] **Step 1: Add imports**

Find the import block at the top. After the existing imports add:

```tsx
import { AnswerPaneResizer } from './AnswerPaneResizer'
import {
  DEFAULT_ANSWER_MAX_HEIGHT,
  clampAnswerHeight,
  computeHardCap
} from './answerPaneResize'
```

- [ ] **Step 2: Add hooks for userMaxHeight + hardCap**

Inside `OverlayApp()`, right after the existing `const allQuestions = useQuestions((s) => s.questions)` line, add:

```tsx
const persistedAnswerMax = settings?.overlayAnswerMaxHeight ?? DEFAULT_ANSWER_MAX_HEIGHT
const [userMaxHeight, setUserMaxHeight] = useState<number>(persistedAnswerMax)
const [hardCap, setHardCap] = useState<number>(() =>
  typeof window !== 'undefined' ? computeHardCap(window.screen.availHeight) : 720
)

// Re-derive hardCap on screen change. Listening to `resize` is enough for
// monitor swaps under Electron because the overlay window itself resizes
// when moved between displays.
useEffect(() => {
  function recompute() {
    setHardCap(computeHardCap(window.screen.availHeight))
  }
  window.addEventListener('resize', recompute)
  return () => window.removeEventListener('resize', recompute)
}, [])

// Adopt the persisted value when settings load / change, clamped to the
// current hardCap. We don't write the clamp back to settings — returning to a
// bigger monitor should restore the user's original preference.
useEffect(() => {
  setUserMaxHeight(clampAnswerHeight(persistedAnswerMax, hardCap))
}, [persistedAnswerMax, hardCap])
```

- [ ] **Step 3: Persist on commit (debounced)**

In the same component body, add the commit handler:

```tsx
const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
const commitAnswerMaxHeight = useCallback((next: number) => {
  if (persistTimer.current) clearTimeout(persistTimer.current)
  persistTimer.current = setTimeout(() => {
    void window.zanban.settings.set({ overlayAnswerMaxHeight: next })
  }, 300)
}, [])

useEffect(
  () => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
  },
  []
)
```

You will need to add `useCallback` and `useRef` to the existing `react` import line.

- [ ] **Step 4: Replace static clamp with dynamic maxHeight**

Find the `hasHistory && (...)` block (currently around line 481):

```tsx
<div
  ref={historyRef}
  data-interactive
  className="flex min-w-0 max-h-[clamp(320px,calc(100vh-180px),640px)] flex-col gap-3 overflow-y-auto overflow-x-hidden px-1 py-1"
>
```

Replace with:

```tsx
<div
  ref={historyRef}
  data-interactive
  style={{ maxHeight: `${userMaxHeight}px` }}
  className="flex min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-1 py-1"
>
```

- [ ] **Step 5: Render the resizer after the history block**

Immediately after the closing `</div>` of the history block (still inside the `hasContent &&` panel), add:

```tsx
{hasHistory && (
  <AnswerPaneResizer
    value={userMaxHeight}
    hardCap={hardCap}
    onChange={setUserMaxHeight}
    onCommit={commitAnswerMaxHeight}
  />
)}
```

The resizer only appears when there is something to resize — the panel does not need a handle while the answer list is empty.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: PASS (all previous + the new tests from Task 2 and Task 3).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/windows/overlay/OverlayApp.tsx
git commit -m "feat(overlay): user-controlled answer pane height with persisted cap"
```

---

## Task 6: Wire handleAnswer into chip and IPC listener

**Files:**
- Modify: `src/renderer/src/windows/overlay/OverlayApp.tsx`

- [ ] **Step 1: Add import**

In the same overlay import block add:

```tsx
import { decideAnswerAction } from './handleAnswer'
```

- [ ] **Step 2: Add the `handleAnswer` callback inside `OverlayApp`**

Place this right after `runPrompt` is defined (around line 292, before `useEffect(() => { runPromptRef.current = runPrompt })`):

```tsx
const handleAnswer = useCallback((): void => {
  const action = decideAnswerAction({
    questions: useQuestions.getState().questions,
    autoDetectQuestions: settings?.autoDetectQuestions
  })
  if (action.kind === 'answerDetected') {
    useQuestions.getState().markAnswered(action.questionId)
    void runPrompt(action.questionText, 'Answer last question')
  } else {
    void runPrompt(action.prompt, 'Answer last question', undefined, action.waitForTranscript)
  }
}, [settings?.autoDetectQuestions])

const handleAnswerRef = useRef(handleAnswer)
useEffect(() => {
  handleAnswerRef.current = handleAnswer
})
```

The ref mirrors the pattern already used for `runPromptRef` — the IPC listener registered in the mount effect captures only the initial closure, so we route through a ref to always call the latest version.

- [ ] **Step 3: Replace the chip handler**

Find the `onAnswer={() => void runPrompt(ANSWER_LAST_PROMPT, ...)` in the `ActionChipsRow` props (around line 392):

```tsx
onAnswer={() =>
  void runPrompt(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
}
```

Replace with:

```tsx
onAnswer={handleAnswer}
```

- [ ] **Step 4: Replace the IPC listener**

Find the `onAnswerLast` registration in the mount effect (around line 191):

```tsx
const offAnswerLast = window.zanban.overlay.onAnswerLast(() => {
  void runPromptRef.current(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
})
```

Replace with:

```tsx
const offAnswerLast = window.zanban.overlay.onAnswerLast(() => {
  handleAnswerRef.current()
})
```

- [ ] **Step 5: Verify ANSWER_LAST_PROMPT is still imported**

It is still used by the fallback branch inside `decideAnswerAction`, which imports it itself. The import at the top of `OverlayApp.tsx` may now be unused — if your editor flags it, leave it; the next task removes it if so.

Check usage in `OverlayApp.tsx`:

Run: `grep -n ANSWER_LAST_PROMPT src/renderer/src/windows/overlay/OverlayApp.tsx`
Expected: only the import line should remain. If so, remove the symbol from the import:

```tsx
import {
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '@shared/prompts'
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/windows/overlay/OverlayApp.tsx
git commit -m "fix(overlay): answer the latest detected question instead of re-deriving from stale transcript"
```

---

## Task 7: Manual smoke

**Files:**
- None — runtime verification only

- [ ] **Step 1: Build dev**

Run: `pnpm dev`
Wait for the dashboard to come up.

- [ ] **Step 2: Resize handle behavior**

1. Start a session so the overlay appears.
2. Ask Zanban something so an answer renders.
3. Hover the thin strip directly under the answer list — cursor becomes `ns-resize`.
4. Drag down — pane grows; verify it stops at the `hardCap` (~workArea − 200, capped at 720 px).
5. Drag up — pane shrinks; verify it stops at 200 px.
6. Double-click the strip — pane resets to 320 px.
7. Quit the app entirely, relaunch, start a session, ask again — the last height you set is restored.

- [ ] **Step 3: Stale-answer fix behavior**

Two-person test (one speaks, one drives the overlay):

1. Speaker asks question A → wait for the detected-question pill to appear → click "Ответить". The answer addresses question A.
2. Without delay, speaker asks question B → as soon as the new pill appears, click "Ответить". The answer addresses question B, not A.
3. Repeat 5 times. Every single click should address the question whose pill is currently visible.

Single-person fallback test:

1. Open Settings → flip `autoDetectQuestions` off.
2. Speak a question into the meeting.
3. Click "Ответить" — falls back to `ANSWER_LAST_PROMPT`, waits up to 2.5 s for the transcript, then answers. Verify it still works (slower but functional).

- [ ] **Step 4: Note any regressions**

If you find any, add a follow-up task — do not patch from the smoke task itself.

---

## Self-Review (already performed)

**Spec coverage**

| Spec section | Implementing task |
|---|---|
| §1 Resize handle | Task 3 (component) + Task 5 (wiring) |
| §2 Replace static clamp | Task 5 Step 4 |
| §3 Settings persistence | Task 1 + Task 5 Step 3 |
| §4 Stale-answer fix | Task 4 (decision helper) + Task 6 (wiring) |
| §5 Edge cases — detector off | Task 4 test: "autoDetectQuestions is false" + Task 6 Step 2 |
| §5 Edge cases — no pending | Task 4 test: "no pending questions" |
| §5 Edge cases — drag during stream | Task 5 unchanged ResizeObserver path |
| §5 Edge cases — monitor change | Task 5 Step 2 (hardCap recompute) + Step 4 (clamp at runtime) |
| §5 Edge cases — below MIN | Task 2 + Task 3 clamp tests |
| §5 Edge cases — double-click reset | Task 3 dblclick test |
| §6 Testing | Tasks 2, 3, 4 unit tests + Task 7 manual |

No gaps.

**Placeholder scan:** Searched for TBD / TODO / "similar to" — none present. Every code step includes complete code.

**Type consistency:** `AnswerAction` shape used identically in helper, tests, and OverlayApp call site. `DEFAULT_ANSWER_MAX_HEIGHT`, `MIN_ANSWER_MAX_HEIGHT`, `ABSOLUTE_MAX_ANSWER_HEIGHT` are defined once and re-used. `handleAnswerRef` mirrors the existing `runPromptRef` pattern.
