# Instant Answer on Demand + Mic Transcript Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the answer button stream an answer from the accumulated dialogue instantly (no "is this a question?" LLM step), and make the user's own mic appear in saved session transcripts.

**Architecture:** Approach A — the answer hotkey/button always answers from the recent transcript context via `ANSWER_LAST_PROMPT`. The per-segment question-detection LLM round-trip and its highlight UI are removed. The pre-request transcript-settle wait is shortened, and web search is bounded by a timeout so it can never stall the first token. The missing-mic bug is diagnosed along the capture → finalization → persistence → stop-flush pipeline and fixed at the failing stage.

**Tech Stack:** Electron 33, React 19, TypeScript, Zustand, Vercel AI SDK, Vitest. Code style: no semicolons, single quotes, no trailing commas, 100-col. Spec: `docs/superpowers/specs/2026-05-29-instant-answer-and-mic-fix-design.md`.

**Branch:** `feat/instant-answer-and-mic-fix` (already checked out).

**Verification commands (run from repo root):**
- `pnpm typecheck` — tsc on web + node configs
- `pnpm test` — vitest run
- `pnpm build` — production build

Each task keeps `pnpm typecheck` green on its own. Order matters: consumers are decoupled before dead files are deleted.

---

## Task 1: Answer button always answers from context

Drop the detected-question branch from the overlay's answer handler; it now always answers from the recent transcript. Delete the now-unused decision helper and its test. Shorten the settle wait.

**Files:**
- Modify: `src/renderer/src/windows/overlay/OverlayApp.tsx`
- Delete: `src/renderer/src/windows/overlay/handleAnswer.ts`
- Delete: `src/renderer/src/windows/overlay/handleAnswer.test.ts`

- [ ] **Step 1: Delete the decision helper and its test**

```bash
git rm src/renderer/src/windows/overlay/handleAnswer.ts src/renderer/src/windows/overlay/handleAnswer.test.ts
```

- [ ] **Step 2: Remove the helper + questions-store imports from OverlayApp**

In `src/renderer/src/windows/overlay/OverlayApp.tsx`, delete these two import lines:

```ts
import { useQuestions } from '@renderer/features/transcript/questionsStore'
```
```ts
import { decideAnswerAction } from './handleAnswer'
```

Add `ANSWER_LAST_PROMPT` to the existing `@shared/prompts` import block (lines 29-34) so it reads:

```ts
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '@shared/prompts'
```

- [ ] **Step 3: Simplify `handleAnswer`**

Replace the whole `handleAnswer` callback (currently `OverlayApp.tsx:334-350`) with:

```ts
  const handleAnswer = useCallback((): void => {
    void runPromptRef.current(ANSWER_LAST_PROMPT, 'Answer last question', undefined, true)
  }, [])
```

- [ ] **Step 4: Shorten the transcript settle wait**

In the same file, change the `awaitTranscriptSettle` default parameters (currently `OverlayApp.tsx:292`):

```ts
  async function awaitTranscriptSettle(maxWaitMs = 600, quietMs = 250): Promise<void> {
```

- [ ] **Step 5: Verify nothing else in OverlayApp references the removed symbols**

Run: `pnpm exec tsc --noEmit -p tsconfig.web.json`
Expected: PASS. If it reports `useQuestions`/`decideAnswerAction` still used, remove those remaining usages (there should be none beyond the handler just rewritten).

- [ ] **Step 6: Run the renderer tests**

Run: `pnpm test`
Expected: PASS (the `handleAnswer.test.ts` is gone; `rollingLane`/`RollingTranscript` tests still pass — they are untouched in this task).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(overlay): answer button always answers from context"
```

---

## Task 2: Stop the question-detection LLM round-trip in the transcript store

The renderer transcript store fires an LLM round-trip per system final to detect/clean a question and pushes it into the questions store. Remove that entirely. The store also resets the questions store on a new session — remove that too.

**Files:**
- Modify: `src/renderer/src/features/transcript/store.ts`

- [ ] **Step 1: Remove the questions-store import**

In `src/renderer/src/features/transcript/store.ts`, delete line 8:

```ts
import { useQuestions, maybeExtractQuestion } from './questionsStore'
```

- [ ] **Step 2: Remove the detection + auto-dismiss blocks from `pushSegment`**

Delete everything from the `const candidate = maybeExtractQuestion(seg)` line through the end of the mic auto-dismiss block (currently `store.ts:52-78`), i.e. remove both of these blocks:

```ts
    const candidate = maybeExtractQuestion(seg)
    if (candidate) {
      console.debug('[q] -> LLM', candidate.text.slice(0, 80))
      void window.zanban.ai
        .extractQuestion(candidate.text)
        .then((cleaned) => {
          if (!cleaned) {
            console.debug('[q] LLM returned NONE for:', candidate.text.slice(0, 80))
            return
          }
          console.debug('[q] LLM kept:', cleaned.slice(0, 80))
          useQuestions.getState().push({ ...candidate, text: cleaned })
        })
        .catch((err) => console.warn('[q] LLM error', err))
    }

    // Auto-dismiss pending questions when YOU starts answering. We treat any
    // non-trivial mic-channel final (>=15 chars) within 60s of a pending
    // question as the user beginning to answer it.
    if (seg.isFinal && seg.channel === 'mic' && seg.text.trim().length >= 15) {
      const qs = useQuestions.getState().questions
      const cutoff = seg.createdAt - 60_000
      const target = [...qs]
        .reverse()
        .find((q) => q.status === 'pending' && q.detectedAt >= cutoff)
      if (target) useQuestions.getState().markAnswered(target.id)
    }
```

After this, `pushSegment`'s body ends right after the `set((s) => { ... })` call.

- [ ] **Step 3: Remove the questions-store reset on new session**

In `setSession` (currently `store.ts:88`), delete this line inside the new-session branch:

```ts
        useQuestions.getState().reset()
```

Keep the adjacent `useAi.getState().reset()` line — that one stays.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.web.json`
Expected: PASS.

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(transcript): drop per-segment question-detection round-trip"
```

---

## Task 3: Simplify the rolling transcript (remove question highlight)

`rollingLane` and `RollingTranscript` highlight finals that match a detected question. With detection gone, strip the highlight concept — the strip just renders the recent system finals plus the live partial.

**Files:**
- Modify: `src/renderer/src/windows/overlay/rollingLane.ts`
- Modify: `src/renderer/src/windows/overlay/rollingLane.test.ts`
- Modify: `src/renderer/src/windows/overlay/RollingTranscript.tsx`
- Modify: `src/renderer/src/windows/overlay/RollingTranscript.test.tsx`

- [ ] **Step 1: Rewrite `rollingLane.test.ts` to the new (highlight-free) contract**

Replace the entire contents of `src/renderer/src/windows/overlay/rollingLane.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import type { TranscriptSegment } from '@shared/types'
import { buildLane } from './rollingLane'

const seg = (
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system',
  isFinal = true
): TranscriptSegment => ({
  id,
  channel,
  speaker: 0,
  startMs: 0,
  endMs: 0,
  text,
  isFinal,
  createdAt: 0
})

describe('buildLane', () => {
  it('returns empty lane for empty inputs', () => {
    expect(buildLane({ finals: [], partial: null })).toEqual([])
  })

  it('maps finals to items', () => {
    const out = buildLane({ finals: [seg('a', 'one'), seg('b', 'two')], partial: null })
    expect(out).toEqual([
      { id: 'a', text: 'one', isFinal: true },
      { id: 'b', text: 'two', isFinal: true }
    ])
  })

  it('appends a non-final tail item for a non-empty partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', 'still going', 'system', false)
    })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ id: 'p1-p', text: 'still going', isFinal: false })
  })

  it('drops a whitespace-only partial', () => {
    const out = buildLane({
      finals: [seg('a', 'done')],
      partial: seg('p1', '   ', 'system', false)
    })
    expect(out).toHaveLength(1)
  })

  it('truncates to the last `limit` finals but always keeps the partial', () => {
    const finals = Array.from({ length: 10 }, (_, i) => seg(`f${i}`, `t${i}`))
    const out = buildLane({ finals, partial: seg('p', 'tail', 'system', false), limit: 3 })
    expect(out.map((x) => x.id)).toEqual(['f7', 'f8', 'f9', 'p-p'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test rollingLane`
Expected: FAIL — `buildLane` still requires `questions`/`autoDetectQuestions`, and items still carry a `highlight` field.

- [ ] **Step 3: Rewrite `rollingLane.ts`**

Replace the entire contents of `src/renderer/src/windows/overlay/rollingLane.ts` with:

```ts
import type { TranscriptSegment } from '@shared/types'

export interface LaneItem {
  id: string
  text: string
  isFinal: boolean
}

export interface BuildLaneArgs {
  /** System-channel finals, in chronological order. Caller filters by channel. */
  finals: TranscriptSegment[]
  /** Current system-channel partial, or null. */
  partial: TranscriptSegment | null
  /** Last N finals to keep; older finals are dropped before mapping. Default 40. */
  limit?: number
}

const DEFAULT_LIMIT = 40

export function buildLane({ finals, partial, limit = DEFAULT_LIMIT }: BuildLaneArgs): LaneItem[] {
  const out: LaneItem[] = finals.slice(-limit).map((seg) => ({
    id: seg.id,
    text: seg.text,
    isFinal: true
  }))

  if (partial && partial.text.trim().length > 0) {
    out.push({ id: `${partial.id}-p`, text: partial.text, isFinal: false })
  }

  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test rollingLane`
Expected: PASS.

- [ ] **Step 5: Update `RollingTranscript.tsx`**

In `src/renderer/src/windows/overlay/RollingTranscript.tsx`:

Delete these two import lines:

```ts
import { useQuestions } from '@renderer/features/transcript/questionsStore'
import { useSettingsStore } from '@renderer/features/settings/store'
```

Delete these two hook reads inside the component (currently lines 15-16):

```ts
  const questions = useQuestions((s) => s.questions)
  const autoDetect = useSettingsStore((s) => s.settings?.autoDetectQuestions)
```

Replace the `buildLane` memo (currently lines 20-30) with:

```ts
  const lane = useMemo(
    () => buildLane({ finals: systemFinals, partial, limit: SYSTEM_LIMIT }),
    [systemFinals, partial]
  )
```

Replace the `SegmentSpan` component (currently lines 87-111) with the highlight-free version:

```ts
function SegmentSpan({ item }: { item: LaneItem }) {
  if (!item.isFinal) {
    return (
      <span className="text-muted-foreground/70">
        {item.text}
        <span className="text-muted-foreground/60">▍</span>
      </span>
    )
  }
  return <span className="text-foreground/85">{item.text}</span>
}
```

- [ ] **Step 6: Rewrite `RollingTranscript.test.tsx` to drop the highlight tests**

Replace the entire contents of `src/renderer/src/windows/overlay/RollingTranscript.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { TranscriptSegment } from '@shared/types'
import { useTranscript } from '@renderer/features/transcript/store'
import { RollingTranscript } from './RollingTranscript'

function fSeg(
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment {
  return { id, text, channel, speaker: 0, startMs: 0, endMs: 0, isFinal: true, createdAt: 0 }
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
})

afterEach(() => {
  cleanup()
})

function makeRunning(): void {
  useTranscript.setState({ session: { kind: 'running', sessionId: 's1', startedAt: 0 } })
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

  it('shows partial system text in the tail with the cursor glyph', () => {
    makeRunning()
    useTranscript.setState({
      partials: {
        mic: null,
        system: {
          id: 'p1',
          text: 'still talking',
          channel: 'system',
          speaker: 0,
          startMs: 0,
          endMs: 0,
          isFinal: false,
          createdAt: 0
        }
      }
    })
    const { getByTestId } = render(<RollingTranscript />)
    const el = getByTestId('overlay-rolling-transcript')
    expect(el.textContent).toContain('still talking')
    expect(el.textContent).toContain('▍')
  })
})
```

- [ ] **Step 7: Run the rolling-transcript tests**

Run: `pnpm test RollingTranscript`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(overlay): strip question highlight from rolling transcript"
```

---

## Task 4: Delete the dead question-detection files

Nothing imports `questionsStore` or `DetectedQuestions` after Tasks 1-3. `DetectedQuestions` was never rendered anywhere. Delete both.

**Files:**
- Delete: `src/renderer/src/features/transcript/questionsStore.ts`
- Delete: `src/renderer/src/features/transcript/DetectedQuestions.tsx`

- [ ] **Step 1: Confirm there are no remaining importers**

Run: `pnpm exec tsc --noEmit -p tsconfig.web.json` and also search:
Search the repo for `questionsStore` and `DetectedQuestions` (excluding `docs/`).
Expected: no source references remain (only the files themselves).

- [ ] **Step 2: Delete the files**

```bash
git rm src/renderer/src/features/transcript/questionsStore.ts src/renderer/src/features/transcript/DetectedQuestions.tsx
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(transcript): remove dead question-detection components"
```

---

## Task 5: Remove the now-dead `autoDetectQuestions` setting

The setting only drove question detection. Remove the field, its default, the settings-panel toggle, and its i18n strings.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/settings/SettingsPanel.tsx`
- Modify: `src/shared/locales/en.json`
- Modify: `src/shared/locales/ru.json`
- Modify: `src/main/index.ts` (comment only)

- [ ] **Step 1: Remove the type field and default**

In `src/shared/types.ts` delete the field declaration (currently line 260):

```ts
  autoDetectQuestions: boolean
```

and the default entry (currently line 550):

```ts
  autoDetectQuestions: true,
```

- [ ] **Step 2: Remove the settings-panel toggle row**

In `src/renderer/src/features/settings/SettingsPanel.tsx` delete the auto-detect `Row` (currently lines 518-526):

```tsx
        <Row
          label={t('settings.general.auto_detect_label')}
          hint={t('settings.general.auto_detect_hint')}
        >
          <Switch
            checked={settings.autoDetectQuestions}
            onCheckedChange={(v) => update('autoDetectQuestions', v)}
          />
        </Row>
```

The enclosing `assistant` `Section` stays — it still wraps the transcript-window field.

- [ ] **Step 3: Remove the i18n keys**

In `src/shared/locales/en.json` delete these two lines (currently 302-303):

```json
      "auto_detect_label": "Auto-detect questions from the other speaker",
      "auto_detect_hint": "When the other side asks something, surface it as a chip you can answer in one click.",
```

In `src/shared/locales/ru.json` delete the matching `auto_detect_label` and `auto_detect_hint` keys under `settings.general`. (Search the file for `auto_detect_label` to find them; remove both lines, keeping the JSON valid — no trailing comma issues.)

- [ ] **Step 4: Fix the stale comment in main**

In `src/main/index.ts` (currently line 356) the comment references `autoDetectQuestions`. Update it to drop that name:

```ts
    // `hideWidgetWhenHidden` until app restart.
```

(If the surrounding sentence reads differently, just remove the `autoDetectQuestions` mention while keeping the rest accurate.)

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — TypeScript flags any remaining `settings.autoDetectQuestions` reference. There should be none left.

- [ ] **Step 6: Verify the locale JSON parses**

Run: `pnpm test`
Expected: PASS (any i18n-key test stays green; both locale files remain valid JSON).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(settings): remove dead autoDetectQuestions setting"
```

---

## Task 6: Remove the `extractQuestion` IPC surface, main impl, and prompt

Tear out the cross-process `ai.extractQuestion` API end to end.

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/main/ai/aiGatewayClient.ts`
- Modify: `src/main/ai/prompts.ts`

- [ ] **Step 1: Remove the channel constant**

In `src/shared/ipc-channels.ts`, the `ai` group ends with (currently lines 38-39):

```ts
    error: 'ai:error',
    extractQuestion: 'ai:extract-question'
```

Change it to drop the extractQuestion entry (and the now-trailing comma):

```ts
    error: 'ai:error'
```

- [ ] **Step 2: Remove the renderer-facing type**

In `src/shared/api.ts` delete the method line (currently line 84):

```ts
    extractQuestion(text: string): Promise<string | null>
```

- [ ] **Step 3: Remove the preload bridge**

In `src/preload/index.ts` the `ai` block ends with (currently lines 47-48):

```ts
    onError: (cb) => on(IPC.ai.error, cb),
    extractQuestion: (text) => ipcRenderer.invoke(IPC.ai.extractQuestion, text)
```

Change it to:

```ts
    onError: (cb) => on(IPC.ai.error, cb)
```

- [ ] **Step 4: Remove the main IPC handler**

Replace the entire contents of `src/main/ipc/ai.ts` with:

```ts
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { ask as aiAsk } from '../ai/aiGatewayClient.js'

export function registerAiHandlers(): void {
  ipcMain.handle(
    IPC.ai.ask,
    (
      _e,
      input: {
        prompt: string
        contextSeconds?: number
        imageDataUrl?: string
        ocrText?: string
        modelOverride?: string
      }
    ) => aiAsk(input)
  )
}
```

- [ ] **Step 5: Remove `extractQuestion` and its now-unused imports from the gateway client**

In `src/main/ai/aiGatewayClient.ts`:

Delete the `extractQuestion` function (currently lines 361-384, the whole `export async function extractQuestion ... }` block at the end of the file).

Remove `generateOneShot` from its import (currently line 17) — delete the line:

```ts
import { generateOneShot } from './llm/baseLlm.js'
```

Remove `QUESTION_EXTRACTOR_PROMPT` from the `./prompts.js` import block (currently lines 9-14) so it reads:

```ts
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildVisionSystemPrompt
} from './prompts.js'
```

- [ ] **Step 6: Remove the extractor prompt constant**

In `src/main/ai/prompts.ts` delete the entire `export const QUESTION_EXTRACTOR_PROMPT = ` template-literal block (currently lines 68-110, ending at the line `Output: Tell me about a time when you had to debug a really nasty production issue.\``).

- [ ] **Step 7: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS on both web and node configs.

- [ ] **Step 8: Run tests**

Run: `pnpm test`
Expected: PASS. `src/shared/prompts.test.ts` asserts the *shared* user-facing prompts only; `QUESTION_EXTRACTOR_PROMPT` lived in `src/main/ai/prompts.ts`, so its removal does not touch that test.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ai): remove extractQuestion IPC, impl, and extractor prompt"
```

---

## Task 7: Web search must not block the first token

`ask()` awaits Tavily before assembling the prompt. Bound it with a hard timeout via a small reusable helper so a slow search can never stall the answer.

**Files:**
- Create: `src/main/ai/raceTimeout.ts`
- Create: `src/main/ai/raceTimeout.test.ts`
- Modify: `src/main/ai/aiGatewayClient.ts`

- [ ] **Step 1: Write the failing test for the timeout helper**

Create `src/main/ai/raceTimeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { raceTimeout } from './raceTimeout'

describe('raceTimeout', () => {
  it('resolves with the promise value when it wins', async () => {
    const out = await raceTimeout(Promise.resolve('ok'), 50, 'fallback')
    expect(out).toBe('ok')
  })

  it('resolves with the fallback when the promise is too slow', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('late'), 100))
    const out = await raceTimeout(slow, 10, 'fallback')
    expect(out).toBe('fallback')
  })

  it('resolves with the fallback when the promise rejects', async () => {
    const out = await raceTimeout(Promise.reject(new Error('boom')), 50, 'fallback')
    expect(out).toBe('fallback')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test raceTimeout`
Expected: FAIL — `raceTimeout` does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `src/main/ai/raceTimeout.ts`:

```ts
/**
 * Resolve with `promise`'s value if it settles within `ms`, otherwise resolve
 * with `fallback`. A rejection is treated like a timeout — caller gets the
 * fallback, never a throw. Used to keep optional augmentation (web search) off
 * the critical path of a streamed answer.
 */
export function raceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const done = (value: T): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => done(fallback), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        done(value)
      })
      .catch(() => {
        clearTimeout(timer)
        done(fallback)
      })
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test raceTimeout`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the web-search block**

In `src/main/ai/aiGatewayClient.ts` add the import next to the other local `./` imports:

```ts
import { raceTimeout } from './raceTimeout.js'
```

Replace the web-search block in `ask()` (currently lines 123-135) with a timeout-bounded version:

```ts
      let webSearchBlock = ''
      const webProvider = settings.autoWebSearch ? getActiveWebSearch() : null
      if (webProvider && opts.prompt.trim().split(/\s+/).length >= 4) {
        const hits = await raceTimeout(
          webProvider.search(opts.prompt, { topK: 3 }).catch(() => []),
          800,
          []
        )
        if (hits.length > 0) {
          const lines = hits.map((h) => `[${h.title}](${h.url})\n${h.snippet}`).join('\n\n')
          webSearchBlock = `\n\n<web_search>\nLive results from a web search performed just now. Cite URLs when you use a fact from here.\n\n${lines}\n</web_search>`
        }
      }
```

- [ ] **Step 6: Verify typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "perf(ai): cap web search at 800ms so it never stalls the answer"
```

---

## Task 8: Fix the missing mic transcript (diagnose, then fix)

Storage and render already handle both channels (`sessionSync.ts` stores `channel`; `SessionDetail.tsx` labels `mic → "You"`). So mic finals are dropping somewhere upstream. VAD is **off by default** (`vadEnabled: false`, `vadThreshold: 0.005` in `src/shared/types.ts`) — do not assume the energy gate is the cause. Diagnose the pipeline in order, then apply the narrowest fix at the failing stage.

**Files (diagnosis):**
- Read/observe: `src/renderer/src/audio/micCapture.ts` (peak-amplitude diagnostics already present)
- Read/observe: `src/main/transcription/sessionManager.ts`, `src/main/sync/sessionSync.ts`
- Read/observe: the active STT client (default `src/main/transcription/deepgramSttClient.ts`)

- [ ] **Step 1: Reproduce with diagnostics**

Run: `pnpm dev`. Start a session with the mic enabled, speak several full sentences into the mic while also playing system audio (e.g. a video) so both channels are active. End the session, open it in the dashboard, and check the Transcript tab.

Record which of the following you observe in the DevTools console (overlay/dashboard renderer) and the Electron main log:
- `[audio:mic] chunk #N, peak=…` — is the mic peak above SILENCE (>1%) while you speak?
- mic **final** segments arriving (look for transcript "You" lines appearing live in `LiveTranscript`).

- [ ] **Step 2: Localize the failing stage**

Walk the pipeline using the observations from Step 1:

- **(A) No `[audio:mic]` chunks, or peak stuck at SILENCE while speaking** → capture/device problem. The wrong input device is selected, or mic permission/`getUserMedia` returned a dead track. Confirm `settings.audio.micDeviceId` resolves to the device you are speaking into.
- **(B) Chunks flow with real peak, but no mic "You" lines appear live** → STT finalization problem on the mic channel. Inspect the active STT client; confirm the mic channel connects and emits finals the same way the system channel does.
- **(C) Mic "You" lines appear live but are absent from the saved session** → persistence/stop-flush problem. `SessionManager.stop()` (`sessionManager.ts:95-111`) closes channels synchronously; finals emitted during teardown can be lost before `flush()` runs.

- [ ] **Step 3: Apply the fix for the localized stage**

Apply only the branch that matches Step 2:

- **Branch (A) — device/permission.** If `micDeviceId` points at the wrong/absent device, fix device resolution in `startMic` (`src/renderer/src/audio/micCapture.ts:90-103`): when an `exact` deviceId fails, fall back to the default device instead of yielding a dead track. Concretely, drop `exact` and let the browser pick the default when the saved id is unavailable:

```ts
export async function startMic(
  deviceId?: string | null,
  vad?: { enabled: boolean; threshold: number }
): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })
  return startCapture({ channel: 'mic', stream, vad })
}
```

- **Branch (B) — STT finalization.** Fix the per-channel handling in the active STT client so the mic channel finalizes segments identically to the system channel (e.g. matching endpointing / interim-to-final promotion). The exact edit lives in `src/main/transcription/deepgramSttClient.ts` and is determined by what the inspection shows differs between channels.

- **Branch (C) — stop-flush.** In `SessionManager.stop()` (`src/main/transcription/sessionManager.ts`), await a final drain of in-flight segments before clearing channels, so trailing mic finals reach `sessionSync`'s buffer. Coordinate with `sessionSync.flush()` (already invoked via `onSessionEnd`) — ensure the channel close happens after the last segment is delivered to listeners, not before.

- [ ] **Step 4: Add a regression test if the fix is in pure/testable code**

If the fix lands in branch (C) and you factor the drain into a pure helper, co-locate a `*.test.ts` next to it asserting that a trailing mic final is included after stop. If the fix is in branch (A) device resolution or (B) STT client (both hard to unit-test without mocking the SDK/`getUserMedia`), skip the unit test and rely on the manual reproduction in Step 6 — note in the commit message that it is manually verified.

- [ ] **Step 5: Verify typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`. Repeat the Step 1 reproduction. Confirm mic "You" lines now appear **both** live and in the saved session's Transcript tab alongside the "Them" lines.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(transcription): include mic channel in saved session transcript"
```

---

## Final verification

- [ ] **Step 1: Full green build**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 2: End-to-end manual check**

Run: `pnpm dev`. Start a session, let a short dialogue accumulate, press the answer hotkey (`Ctrl+Shift+Enter`), and confirm the answer starts streaming within a fraction of a second — no multi-second "thinking" pause and no question-detection step. End the session and confirm both "You" and "Them" lines are saved.

- [ ] **Step 3: Confirm the design's scope is fully covered**

The instant-answer path (Tasks 1-3, 6, 7), the detection removal (Tasks 2-6), and the mic fix (Task 8) together cover every in-scope item in the spec. Nothing out-of-scope (auto-answer, new providers, usage tracking) was added.
