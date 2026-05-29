# Instant answer on demand + mic transcript fix — design

Date: 2026-05-29
Status: approved (design phase)
Branch: `feat/instant-answer-and-mic-fix`

## Problem

Two pains in the live interview-copilot flow:

1. **Latency / "it thinks too long."** Getting an answer to the other
   speaker's question feels slow. Three sources:
   - A per-segment LLM round-trip (`ai.extractQuestion`) runs on every final
     system-channel segment just to decide *"is this a question?"* and clean
     it. This is the "thinking about whether it's a question" the user wants
     gone.
   - The answer button waits on `awaitTranscriptSettle` (up to **2.5 s**)
     before it even fires the request.
   - `ask()` calls Tavily web search **before** the first token streams. On
     the answer-from-context path the search runs against the *prompt
     instruction text* (`ANSWER_LAST_PROMPT`, which is >4 words), so it both
     stalls the answer and searches something meaningless.

2. **Mic transcript missing from finished sessions.** When a session ends, the
   saved transcript shows only the other speaker (system channel, "Them"); the
   user's own mic ("You") is absent — "as if it wasn't heard."

## Goal

The dialogue (mic + system) accumulates in the transcript. On a single
hotkey/button press, the assistant **immediately** streams an answer based on
the accumulated context. No "is this a question?" deliberation. Minimize the
gap between press and first token. Separately: the user's mic must appear in
the saved transcript.

Chosen approach: **A — "Clean context on press"** (manual trigger, no
detection). Rejected: auto-answer on pause (false triggers, wastes tokens,
user explicitly wants a button) and optimistic-streaming stub (more complex,
doesn't fix the root).

## Scope

### In scope

1. Answer button always answers from accumulated context.
2. Remove the question-detection LLM round-trip and its plumbing.
3. Remove the detected-questions highlight UI entirely.
4. Shorten the pre-request transcript settle wait.
5. Stop web search from blocking the first token of an answer.
6. Diagnose and fix the missing mic transcript.

### Out of scope (YAGNI)

Auto-answer mode, new LLM/STT providers, company research, salary negotiation,
JD/resume context, usage/cost tracking. Speed and the mic bug only.

## Design

### 1. Answer flow — always answer from context

- `src/renderer/src/windows/overlay/OverlayApp.tsx` — `handleAnswer` always
  runs the context path: `runPrompt(ANSWER_LAST_PROMPT, 'Answer last
  question', undefined, /* waitForTranscript */ true)`. Drop the
  `decideAnswerAction` branch that routed through the detected-questions store.
- `src/renderer/src/windows/overlay/handleAnswer.ts` and `decideAnswerAction`
  are removed (no other caller after the change). Its test file goes with it.
- `AskPanel.tsx` already calls `ask({ prompt: ANSWER_LAST_PROMPT })` directly —
  unchanged.

### 2. Tighten `awaitTranscriptSettle`

- In `OverlayApp.tsx`, reduce the defaults from `maxWaitMs = 2500, quietMs =
  600` to `maxWaitMs = 600, quietMs = 250`. The dialogue is already buffered;
  the short quiet window only guards against firing mid-word. No new setting —
  keep it simple.

### 3. Web search must not block the first token

- `src/main/ai/aiGatewayClient.ts` — `ask()`. The web-search block currently
  `await`s Tavily before assembling the prompt. Bound it with a hard timeout
  (~800 ms) so a slow/oversized search can never stall the answer; on timeout,
  proceed with no web block (same as the existing failure path). This keeps
  `autoWebSearch` working for users who want it without paying latency on every
  answer. RAG (`retrieveContext`, local sqlite-vec) stays — it is fast.

### 4. Remove question detection

Delete the round-trip and its plumbing:

- `src/renderer/src/features/transcript/store.ts` — remove the
  `maybeExtractQuestion` → `window.zanban.ai.extractQuestion` call and the
  push to `useQuestions`. The mic-channel "auto-dismiss pending question on
  answer" block goes too (no pending questions to dismiss).
- `src/main/ai/aiGatewayClient.ts` — remove `extractQuestion()`.
- `src/main/ipc/ai.ts` — remove the `IPC.ai.extractQuestion` handler.
- `src/shared/ipc-channels.ts`, `src/shared/api.ts`, `src/preload/index.ts` —
  remove the `ai.extractQuestion` surface.
- `src/main/ai/prompts.ts` — remove `QUESTION_EXTRACTOR_PROMPT`.
- Detected-questions UI: delete `DetectedQuestions.tsx` and `questionsStore.ts`.
  Their consumers are in the overlay rolling transcript —
  `RollingTranscript.tsx`, `rollingLane.ts` (and tests `rollingLane.test.ts`,
  `RollingTranscript.test.tsx`) — plus `OverlayApp.tsx`. Strip the
  question-highlight wiring there; the transcript still renders every final
  segment, it just no longer highlights "questions."

### 5. Fix missing mic transcript (diagnose first)

Storage (`sessionSync.ts`) and render (`SessionDetail.tsx` `TranscriptTab`,
`SegmentLine`) already handle both channels and label `mic → "You"`,
`system → "Them"`. So mic finals are not reaching persistence. VAD is **off by
default** (`vadEnabled: false`, `vadThreshold: 0.005` in `types.ts`), so the
energy gate is not the default cause — do not assume it.

Reproduce an interview-style session (speak into mic + play system audio) and
walk the pipeline in order, using the existing diagnostics:

1. **Capture** — `[audio:mic] peak=…` logs in `micCapture.ts`: is real mic
   audio flowing (peak > silence)?
2. **Finalization** — do mic final segments arrive? (Each mic final currently
   logs `[q] skip: not system channel` in `questionsStore`; before removing
   that file, use it / a temporary log to confirm.)
3. **Persistence** — does `sessionSync.flush()` receive mic finals (it filters
   `isFinal` and stores `channel`)?
4. **Stop flush** — `SessionManager.stop()` closes channels immediately; check
   whether trailing mic finals emitted during teardown are lost.

Apply the narrowest fix at whichever stage drops the mic. Likely candidates:
mic device/permission selection, the STT channel's per-channel finalization on
the mic stream, or trailing-segment loss at stop. The fix is determined by the
reproduction, not pre-committed here.

## Error handling

- No transcript yet → button is a no-op (existing `runPrompt` guard).
- Web search timeout/failure → swallowed, answer proceeds without a web block.
- All provider/stream errors keep surfacing through the existing
  `IPC.ai.error` → `toast.error` path.

## Testing

- Update/remove tests tied to deleted code: `handleAnswer` /
  `decideAnswerAction` test, any `questionsStore` test. `prompts.test.ts` must
  still pass after removing `QUESTION_EXTRACTOR_PROMPT` (it asserts the
  user-facing prompt set; confirm the extractor prompt is not in that set).
- `pnpm typecheck`, `pnpm test`, `pnpm build` all green before done.
- Manual: interview-style run — press the answer hotkey, confirm the first
  token appears with no multi-second stall; end the session and confirm "You"
  (mic) lines appear in the saved transcript alongside "Them".

## Risks

- Removing the detected-questions UI touches several files; a missed reference
  breaks the build. `typecheck` catches it.
- Shorter settle window could occasionally answer a half-finished sentence; the
  250 ms quiet guard plus accumulated context makes this rare and recoverable
  (press again).
