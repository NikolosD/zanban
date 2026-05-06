# AGENTS.md

Quick orientation for AI agents working on Zanban — a desktop AI meeting
assistant (Electron + Vite + React 19 + TypeScript).

## Commands

Run from repo root.

```
pnpm dev          # electron-vite dev — main + preload + 4 renderer entries
pnpm build        # production build
pnpm typecheck    # tsc --noEmit on both web + node configs
pnpm test         # vitest run (32 tests across pure functions)
pnpm test:watch   # interactive
pnpm lint         # eslint . (flat config, react-hooks + ts-eslint)
pnpm format       # prettier --write .
pnpm analyze      # ANALYZE=1 build → out/bundle-stats.html treemap
```

Always run `typecheck`, `test`, and `build` before declaring a change done.
`lint` currently has known warnings (pre-existing react-hooks v7 patterns) —
add no new ones.

## Layout

```
src/
  main/                  Electron main process (Node)
    ai/                  LLM gateway client + prompt builders + per-role models
    documents/           PDF/DOCX/TXT/MD ingestion + per-session PDF export
    ipc/                 IPC handler registration grouped by domain
    personas/            Persona store
    providers/           LLM + STT + web-search provider abstractions
    rag/                 sqlite-vec embedding + retrieval
    screenshot/          desktopCapturer + OCR pipeline
    services/            Logger, jobs manager, ollama health
    sync/                Session disk persistence (markdown + JSON)
    transcription/       Per-session STT pipeline
    windows/             BrowserWindow factories (main, overlay, cropper, chat)
    settings.ts          electron-store + safeStorage (encrypted secrets)
    shortcuts.ts         globalShortcut registration
    index.ts             App lifecycle + window-stateful IPC handlers
  preload/               window.zanban API bridge (contextBridge)
  renderer/src/
    audio/               Mic + system loopback capture, level meter
    components/
      brand/             Logo + wordmark
      ui/                shadcn-style primitives (Button, Dialog, Kbd, ...)
    features/
      ai/                AskPanel, StreamingMarkdown (lazy), store
      jobs/              Background-job badge
      sessions/          List + detail
      settings/          SettingsPanel + tabs (Providers, Personas, ...)
      transcript/        Live transcript, question detection
    lib/                 Pure helpers: utils, dateFormat, hotkeys, audio
    windows/             Per-window app shells (dashboard, overlay, cropper, chat)
  shared/                Cross-process contracts
    api.ts               window.zanban.* TypeScript surface
    ipc-channels.ts      All IPC channel name constants
    types.ts             AppSettings, LlmProvider, AiModelSettings, ...
    prompts.ts           User-facing prompt strings (single source of truth)
scripts/                 CJS install hooks (sqlite-vec sanity check)
```

## Code style

- **No semis. Single quotes. No trailing commas. 100-col print width.**
  Prettier (`.prettierrc.json`) enforces. ESLint won't fight Prettier
  (eslint-config-prettier active).
- **Default to writing no comments.** Code with well-named identifiers is the
  documentation. Add a comment only when the WHY is non-obvious (a hidden
  constraint, a workaround for a specific bug, behavior that would surprise
  a reader). Don't reference current task / PR / issue numbers — those rot.
- **`type X = ...` for unions, `interface X {}` for object shapes.** Mirror
  what's already there.
- **Imports**: external deps first, then `@shared/*`, then `@renderer/*` /
  `@main/*`, then relative `./`. ESM only — `import { x } from 'foo'`.
- **No `any` unless interfacing with raw third-party SDK shapes.** Existing
  code has zero `any`.
- **Errors**: throw `Error` instances; let them propagate to the IPC boundary.
  Renderer surfaces them via `toast.error(title, { description: msg })`.
- **Logs**: `console.error`/`warn` for actual problems, `console.debug` for
  diagnostic traces (hidden by default in DevTools and Electron logs). Don't
  add `console.log`.

## IPC pattern

Always: renderer → `window.zanban.<domain>.<verb>(args)` → preload `invoke()`
→ main `ipcMain.handle(IPC.<domain>.<verb>, ...)`.

To add an IPC method:

1. Append the channel string to `src/shared/ipc-channels.ts` under its domain.
2. Declare the renderer-side type in `src/shared/api.ts`.
3. Wire the bridge in `src/preload/index.ts` (`(args) => ipcRenderer.invoke(...)`).
4. Register the handler in the matching `src/main/ipc/<domain>.ts`. Stateful
   handlers (those that need overlay/dashboard window refs, stealth state,
   session lifecycle) stay in `src/main/index.ts`.

## Recipes

**Adding an LLM provider.**
1. Append the literal to the `LlmProvider` union in `src/shared/types.ts`.
2. Add per-role defaults to `PROVIDER_MODEL_DEFAULTS`, `PROVIDER_FAST_MODELS`,
   `PROVIDER_VISION_MODELS`. TypeScript will flag any missing slot.
3. Add a UI entry to `LLM_PROVIDERS` in
   `src/renderer/src/features/settings/ProvidersTab.tsx` (name, blurb, badge,
   keyUrl). If the provider needs a single API key, add a row to
   `LLM_KEY_FIELDS` and an `apiKey` field to `AppSettings`. If it needs a
   richer credential block (like Google's project + JSON), branch in
   `LlmCredentials`.
4. Implement `ILlmProvider` in `src/main/providers/llm/<id>.ts` and wire it
   into `resolveProvider()` in `src/main/providers/registry.ts`.

**Adding a hotkey.**
1. Add the field to `AppSettings.hotkeys` and a default to `DEFAULT_SETTINGS`
   in `src/shared/types.ts`.
2. Add a row to both `LABELS` and `HINTS` in `src/renderer/src/lib/hotkeys.ts`
   (the test enforces every key has both — see `lib/hotkeys.test.ts`).
3. Wire the action in `src/main/shortcuts.ts` and pass the callback through
   `registerShortcuts()` from `src/main/index.ts`.

**Editing a user-facing prompt.**
All six are in `src/shared/prompts.ts` — single source of truth. Tests enforce
they stay non-empty and unique (`src/shared/prompts.test.ts`). System prompts
that compose into the LLM call live in `src/main/ai/prompts.ts`.

**Adding a test.**
Co-locate as `<file>.test.ts` next to the module. Default env is node — for
DOM-touching renderer tests add `// @vitest-environment happy-dom` at the
top. Mock electron-bound modules with `vi.mock(...)` + `vi.hoisted(...)` (see
`src/main/ai/models.test.ts` for the pattern).

## Constraints

- **Don't add features the task didn't ask for.** No surrounding cleanup on a
  bug fix. No abstractions for hypothetical future requirements. Three
  similar lines beat a premature helper.
- **Don't add fallbacks / validation for cases that can't happen.** Trust
  internal code and framework guarantees. Validate only at system boundaries
  (user input, external APIs).
- **Don't create new docs / planning files.** Work from conversation context.
  README.md, DESIGN.md, PRODUCT.md exist — extend them only if explicitly
  asked.
- **Don't push to `main` directly.** Develop on the assigned feature branch;
  merge only when the user says so.
- **Don't skip git hooks (`--no-verify`).** Fix the underlying issue.
- **Don't modify `pnpm-lock.yaml` by hand.** Always go through `pnpm add` /
  `pnpm remove`.

## Useful invariants to know

- **Stealth posture.** `setContentProtection` is the only mechanism that
  hides a Chromium window from screen-share. `applyStealth()` in
  `src/main/index.ts` keeps overlay + dashboard in lockstep, with a Windows-
  specific double-tap workaround for unreliable first calls. Don't simplify
  it without testing on Windows.
- **First-paint content protection.** On Windows the protection silently
  drops if applied before first show. Every window's `'show'` event re-
  applies — preserve this when touching window setup.
- **Auto-save settings.** Settings panel debounces 350 ms then pushes the
  whole `AppSettings` object to main, which broadcasts to every window. Skip
  the first auto-save trigger (it would re-save freshly-loaded settings).
- **Session lifecycle.** Starting a session: capture-controller starts mic
  (and system loopback if enabled) → renderer streams PCM chunks via
  `IPC.audio.chunk` → main routes to the active STT provider. Stopping
  flushes queued segments to disk + writes the session markdown.
- **RAG cleanup.** Deleting a session also deletes its sqlite-vec rows
  (best-effort — RAG may be unavailable; non-fatal).

## Security posture

Posture is "trusted local app, hostile screen-recorders". The threat model
is *other people seeing what's on the user's screen*, not *the user
attacking themselves*.

- **`contextIsolation: true`** on every `BrowserWindow`. Renderer code never
  touches Node APIs directly — everything goes through the typed
  `window.zanban` bridge in `src/preload/index.ts`.
- **`sandbox: false`** on every window. We need the preload to use
  `node:fs`, `electron.webUtils.getPathForFile`, and audio worklet plumbing
  that sandboxed renderers can't reach. Acceptable because all renderer code
  is first-party and the preload only exposes the IPC surface declared in
  `src/shared/api.ts`.
- **`nodeIntegration: false`** (Electron default; never overridden).
- **CSP meta tag** on every renderer entry HTML (`src/renderer/*.html`).
  Renderer never makes outbound network calls itself — every API request
  goes through main — so `connect-src` stays tight to `'self'` plus the
  vite HMR WebSocket. `'unsafe-eval'` is required for vite HMR in dev and
  is harmless in production (vite doesn't emit eval'd code). `'unsafe-
  inline'` for styles is required by Tailwind runtime + sonner inline
  custom-properties.
- **`setContentProtection(true)`** on overlay + dashboard so screen-share
  capture sees a black rectangle. `applyStealth()` in `src/main/index.ts`
  has a Windows-specific double-tap workaround for unreliable first calls.
- **Secrets at rest** go through `safeStorage` (DPAPI on Windows, Keychain
  on macOS, libsecret on Linux). See `ENCRYPTED_KEYS` in
  `src/main/settings.ts`.
- **Crash dumps** stay on-device (`crashReporter.start({ uploadToServer:
  false })`). Users can attach them to a bug report manually from
  `app.getPath('crashDumps')`.
