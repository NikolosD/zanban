# Overlay answer pane: user-resizable height & stale-answer fix

**Date:** 2026-05-19
**Status:** Design
**Scope:** Overlay window — answer history pane

## Problem

Two issues in the overlay's answer area (`OverlayApp.tsx`):

1. **No user control over height.** The OS window auto-grows with content via
   `ResizeObserver` + `setContentHeight` IPC. The inner answer list is capped
   only by `max-h-[clamp(320px,calc(100vh-180px),640px)]`. For long answers the
   panel sprawls down the screen and there is no way for the user to choose a
   smaller (or larger) ceiling. They want a manual handle plus a hard maximum.

2. **First click of "Ответить" answers the previous question.** When the user
   clicks the Answer chip right after the interviewer finishes speaking, STT
   has not yet finalised the latest segment. `awaitTranscriptSettle` only
   waits up to 600 ms of quiet, then `transcriptBuffer.recent()` is passed to
   the LLM with a stale tail — so the model answers the **previous** question.
   A second click 1–2 seconds later catches up and produces the right answer.

## Goals

- User can drag a handle to set the max height of the answer history pane.
- A hard cap prevents the pane from ever exceeding the screen's work area.
- The chosen height persists across sessions and app restarts.
- A single click on "Ответить" responds to the **latest** detected question
  even when STT has not flushed the very last segment yet.
- No regression for users who have `autoDetectQuestions` disabled.

## Non-goals

- Native OS window resize (frameless transparent windows make this fragile).
- Width control — the panel keeps its current `max-w-[680px]`.
- Changing the LLM prompt for the fallback path.
- Reworking the question-detection pipeline itself.

## Design

### 1. Resize handle

A new 6 px-high horizontal grip between the answer history `div` and
`InputPill`. Visual: `bg-white/5` resting, `bg-white/15` on hover, full-width,
`cursor: ns-resize`, marked `data-interactive` so the overlay's mouse-region
detector does not click-through.

Drag state lives in `OverlayApp.tsx` as `const [userMaxHeight, setUserMaxHeight] = useState<number>(...)` seeded from `settings.overlayAnswerMaxHeight ?? DEFAULT_ANSWER_MAX_HEIGHT`.

Interaction:

- `onMouseDown` — capture `startY = e.clientY`, `startMax = userMaxHeight`,
  attach `mousemove` + `mouseup` to `document`.
- `mousemove` — `next = clamp(startMax + (e.clientY - startY), MIN, hardCap)`,
  call `setUserMaxHeight(next)`. Local state only; settings write deferred.
- `mouseup` — detach listeners; if value changed, debounced (300 ms) call to
  `window.zanban.settings.set({ overlayAnswerMaxHeight: next })`. The settings
  IPC broadcasts back through `wireSettingsIpc`, so the store stays in sync
  without an explicit local apply.
- `onDoubleClick` — `setUserMaxHeight(DEFAULT_ANSWER_MAX_HEIGHT)` + persist
  the same way.

Constants:

```ts
const DEFAULT_ANSWER_MAX_HEIGHT = 320 // px
const MIN_ANSWER_MAX_HEIGHT = 200     // px, anything lower is unusable
```

`hardCap` is computed in a `useEffect` keyed off `window` resize events:

```ts
hardCap = Math.min(window.screen.availHeight - 200, 720)
```

The `- 200` reserves room for status bar, chips row, input pill, and the OS
work area margin maintained by `setContentHeight`'s clamp in main.

If the persisted value exceeds the freshly-computed `hardCap` (e.g. the user
moved to a smaller monitor), the runtime value is clamped down but the stored
preference is left alone so returning to the large monitor restores it.

### 2. Replace the static clamp

Currently in `OverlayApp.tsx` around line 493:

```tsx
className="flex min-w-0 max-h-[clamp(320px,calc(100vh-180px),640px)] ..."
```

becomes

```tsx
className="flex min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-1 py-1"
style={{ maxHeight: `${Math.min(userMaxHeight, hardCap)}px` }}
```

The outer `useLayoutEffect` + `ResizeObserver` that drives `setContentHeight`
is left untouched — when the inner pane shrinks (user dragged up), `panelRef`
height decreases, ResizeObserver fires, the OS window shrinks to match.

### 3. Settings persistence

Add to `AppSettings` (in `src/shared/types.ts`):

```ts
overlayAnswerMaxHeight: number  // px
```

with default `320` in the same defaults block where `autoDetectQuestions: true`
lives. Wire through `wireSettingsIpc` is already generic over the settings
shape — no IPC channel changes needed. The renderer reads via
`useSettingsStore`; writes via the existing `update` action.

### 4. Stale-answer fix — use the latest detected question

`useQuestions` already maintains a list of detected questions with `status`
of `'pending' | 'answered' | …`. We hook into it directly in the Answer
handler.

In `OverlayApp.tsx`, replace the chip handler at line 393 and the IPC
listener at line 192:

```ts
function handleAnswer() {
  const latestPending = useQuestions
    .getState()
    .questions.filter((q) => q.status === 'pending')
    .at(-1)

  if (latestPending && settings?.autoDetectQuestions !== false) {
    useQuestions.getState().markAnswered(latestPending.id)
    void runPrompt(latestPending.text, 'Answer last question')
    return
  }

  // Fallback: detector disabled or nothing detected yet.
  void runPrompt(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
}
```

Both the chip onClick and the IPC `onAnswerLast` callback call
`handleAnswer()`. The pending-question already carries the verbatim text the
detector extracted from the transcript, so we no longer rely on the
LLM-side transcript tail being current.

**Why this works:** `useQuestions` is populated in the renderer by the same
IPC stream that fires far ahead of `awaitTranscriptSettle` returning — the
detector runs on segments as they arrive, and the moment a question is
finalised it is pushed into the store. The Answer chip becomes responsive
the instant the detector emits.

**Marking answered before the request returns** is intentional: it prevents
double-clicks (or rapid taps on the keyboard shortcut) from answering the
same question twice. The pill in `pendingQuestions.slice(-2)` (line 100)
disappears immediately on click, matching the existing detected-question
pill behavior at line 461.

### 5. Edge cases

| Case | Behavior |
|---|---|
| `autoDetectQuestions` off | Falls back to current `ANSWER_LAST_PROMPT` + `awaitTranscriptSettle` flow. No change for those users. |
| No pending question detected yet | Same fallback as above. |
| User drags during a streaming answer | Stream continues; ResizeObserver still resizes OS window to fit smaller history pane. No drag lock. |
| Monitor change → smaller `availHeight` | Runtime `userMaxHeight` clamped to new `hardCap`; persisted value untouched. |
| User drags below `MIN_ANSWER_MAX_HEIGHT` | Clamped to 200 px (still enough to read 2–3 lines of an answer). |
| Double-click on the handle | Resets to `DEFAULT_ANSWER_MAX_HEIGHT` (320 px), persists. |
| DPI scaling | Values are CSS pixels throughout; Electron handles the conversion in `setContentSize`. |

### 6. Testing

- **Unit (renderer):** `<AnswerPaneResizer>` clamp math (min, max, dblclick).
- **Unit (renderer):** Answer-handler branch — pending question present → calls
  `runPrompt` with `q.text` and marks answered; absent / detector off → falls
  back to `ANSWER_LAST_PROMPT`.
- **Manual smoke:**
  1. Open overlay, drag handle up and down, verify clamp at both ends.
  2. Double-click handle → resets to 320 px.
  3. Restart app, verify last height restored.
  4. During live meeting: ask question, click Answer immediately (within
     500 ms of question end) — answer addresses the new question, not the
     previous one. Repeat several times.
  5. Toggle off `autoDetectQuestions` in settings, repeat — fallback path
     still works.

## File-level change list

- `src/shared/types.ts` — add `overlayAnswerMaxHeight: number` to `AppSettings`
  and `320` to the defaults block.
- `src/renderer/src/windows/overlay/OverlayApp.tsx` —
  - new `<AnswerPaneResizer>` component (or inline JSX) above input pill
  - replace static clamp on history pane with `style={{ maxHeight }}`
  - new `handleAnswer()` helper, wired into chip onClick + IPC listener
- No changes to `src/renderer/src/features/settings/store.ts`. The store is
  read-only on the renderer; persistence uses `window.zanban.settings.set`
  which is the same API the rest of the app already uses
  (`OnboardingWizard.tsx:44`).
- Tests: new spec for the resizer math and the Answer branch.

## Open questions

None at design time.
