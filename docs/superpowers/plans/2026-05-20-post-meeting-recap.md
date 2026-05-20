# Post-Meeting Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apgrade SessionDetail's existing unstructured `SummaryTab` into a persisted, structured `RecapTab` (TL;DR / decisions / action items with owner / open questions / follow-up draft), with optional auto-generation on session stop.

**Architecture:** Pure-function core (Zod schema + prompt builder + persistence helpers) feeds a thin main-process orchestrator (`recapService`) that calls the existing LLM provider chain via `generateOneShot`, validates the JSON output against the schema, writes a sidecar file next to the session JSON, and notifies the renderer through a new IPC namespace. The renderer's `RecapTab` reads via TanStack Query and invalidates on push. Auto-generation hooks into `jobsManager` so the existing `JobsBadge` reports progress.

**Tech Stack:** TypeScript, Electron 33, Zod, ai-sdk (one-shot text via `generateOneShot`), Vitest + happy-dom + testing-library, React 19, TanStack Query, Zustand, i18next, Tailwind, electron-store (settings), better-sqlite3 (not touched).

**Spec:** [`docs/superpowers/specs/2026-05-20-post-meeting-recap-design.md`](../specs/2026-05-20-post-meeting-recap-design.md)

---

## File Structure

### New files (main process)
- `src/main/services/recap/recapSchema.ts` — Zod schema, `RecapPayload`, `RecapOptions`, error codes
- `src/main/services/recap/recapPrompt.ts` — pure prompt builder + `PROMPT_VERSION` constant
- `src/main/services/recap/recapPersistence.ts` — sidecar JSON read/write/delete (atomic via tmp + rename)
- `src/main/services/recap/recapService.ts` — orchestrator: build prompt → LLM → validate → persist → broadcast
- `src/main/services/recap/recapAutoTrigger.ts` — listens to session-stop, gates on `settings.recap.autoGenerate`, registers job via `jobsManager.trackJob`
- `src/main/ipc/recap.ts` — IPC handlers for `recap.generate / get / delete`
- Tests: same directory, `.test.ts` for each pure module; `recapService.test.ts` mocks LLM.

### New files (renderer)
- `src/renderer/src/features/sessions/RecapTab.tsx` — UI component
- `src/renderer/src/features/sessions/recapActions.ts` — `formatRecapAsMarkdown`, `formatFollowUpAsPlainText` (pure helpers)
- `src/renderer/src/features/settings/RecapSettingsTab.tsx` — new settings section
- Tests: `RecapTab.dom.test.tsx`, `recapActions.test.ts` in same dir.

### Modified files
- `src/main/ai/llm/recapLlm.ts` — rewrite to call `generateOneShot` with the new schema-aware prompt (was an unused unstructured helper)
- `src/main/ai/llm/index.ts` — export updated `generateRecap`
- `src/main/index.ts` — register `recap` IPC handlers + auto-trigger wiring
- `src/preload/index.ts` — expose `window.zanban.recap` to renderer
- `src/shared/api.ts` — add `recap` namespace + types to `ZanbanApi`
- `src/shared/ipc-channels.ts` — add `IPC.recap.*`
- `src/shared/types.ts` — add `RecapSettings` to `AppSettings` + defaults
- `src/renderer/src/features/sessions/SessionDetail.tsx` — replace inline `SummaryTab` / magic label with `<RecapTab/>`, drop `SUMMARY_LABEL`, drop `generateSummary`
- `src/renderer/src/features/settings/SettingsPanel.tsx` — add Recap section to nav (location TBD by reading file in Task 13)
- `src/shared/locales/en.json`, `src/shared/locales/ru.json` — new keys for `session_detail.recap.*`, `session_detail.tabs.recap`, `settings.recap.*`

---

## Task 1: Zod schema, types, error codes

**Files:**
- Create: `src/main/services/recap/recapSchema.ts`
- Create: `src/main/services/recap/recapSchema.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// src/main/services/recap/recapSchema.test.ts
import { describe, expect, it } from 'vitest'
import { recapSchema, RECAP_SCHEMA_VERSION } from './recapSchema.js'

describe('recapSchema', () => {
  it('accepts a fully-populated payload', () => {
    const parsed = recapSchema.parse({
      tldr: 'We agreed on Q3 milestones.',
      decisions: ['Ship beta by July 15'],
      actionItems: [
        { text: 'Send design doc', owner: 'you' },
        { text: 'Review API contract', owner: 'them', dueHint: 'by Friday' }
      ],
      openQuestions: ['What is the rollout plan for EU users?'],
      followUp: { subject: 'Q3 sync follow-up', body: 'Thanks for the call...' }
    })
    expect(parsed.actionItems[0]?.owner).toBe('you')
    expect(parsed.actionItems[1]?.dueHint).toBe('by Friday')
  })

  it('defaults arrays to empty and follow-up nullable', () => {
    const parsed = recapSchema.parse({ tldr: 'Short call.', followUp: null })
    expect(parsed.decisions).toEqual([])
    expect(parsed.actionItems).toEqual([])
    expect(parsed.openQuestions).toEqual([])
    expect(parsed.followUp).toBeNull()
  })

  it('rejects empty tldr', () => {
    const result = recapSchema.safeParse({ tldr: '', followUp: null })
    expect(result.success).toBe(false)
  })

  it('coerces unknown owner to "unknown" via default', () => {
    const parsed = recapSchema.parse({
      tldr: 'x',
      actionItems: [{ text: 'do thing' }],
      followUp: null
    })
    expect(parsed.actionItems[0]?.owner).toBe('unknown')
  })

  it('exports a stable schema version', () => {
    expect(RECAP_SCHEMA_VERSION).toBe(1)
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/recap/recapSchema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement the schema**

```ts
// src/main/services/recap/recapSchema.ts
import { z } from 'zod'

export const RECAP_SCHEMA_VERSION = 1

const recapItemSchema = z.object({
  text: z.string().min(1),
  owner: z.enum(['you', 'them', 'unknown']).default('unknown'),
  dueHint: z.string().min(1).optional()
})

const followUpSchema = z
  .object({
    subject: z.string().min(1),
    body: z.string().min(1)
  })
  .nullable()

export const recapSchema = z.object({
  tldr: z.string().min(1),
  decisions: z.array(z.string().min(1)).default([]),
  actionItems: z.array(recapItemSchema).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
  followUp: followUpSchema
})

export type RecapCore = z.infer<typeof recapSchema>

export type RecapTone = 'concise' | 'friendly' | 'formal'
export type RecapLanguage = 'auto' | 'en' | 'ru'

export interface RecapOptions {
  tone?: RecapTone
  language?: RecapLanguage
  modelOverride?: string | null
}

export type RecapErrorCode =
  | 'rate_limit'
  | 'timeout'
  | 'no_provider'
  | 'invalid_output'
  | 'no_transcript'
  | 'already_generating'
  | 'unknown'

export interface RecapPayload extends RecapCore {
  schemaVersion: typeof RECAP_SCHEMA_VERSION
  generatedAt: number
  model: string
  promptVersion: number
  partial?: boolean
}

export type RecapResult =
  | { ok: true; recap: RecapPayload }
  | {
      ok: false
      code: RecapErrorCode
      message: string
      partial?: RecapPayload
    }
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/recap/recapSchema.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 1.5: Commit**

```bash
git add src/main/services/recap/recapSchema.ts src/main/services/recap/recapSchema.test.ts
git commit -m "feat(recap): zod schema + payload/result/options types"
```

---

## Task 2: Settings shape — `recap.*` block

**Files:**
- Modify: `src/shared/types.ts` (AppSettings interface + DEFAULT_SETTINGS)

- [ ] **Step 2.1: Read current settings shape**

Read `src/shared/types.ts` around `interface AppSettings` (line ~153) and the `DEFAULT_SETTINGS` object (line ~495 — search for `llmFallbackOrder: []`).

- [ ] **Step 2.2: Add `recap` field to `AppSettings`**

Add inside `AppSettings`, near `overlayAnswerMaxHeight`:

```ts
  /**
   * Post-meeting recap (RecapTab in SessionDetail). Separate from the
   * overlay's mid-meeting "Recap last 90s" chip — that one uses RECAP_PROMPT
   * via ai.ask, this one is the structured, persisted document.
   */
  recap: {
    /** When true, recap generation kicks off automatically on session stop. */
    autoGenerate: boolean
    /** Tone applied to the follow-up draft. */
    tone: 'concise' | 'friendly' | 'formal'
    /** Recap output language; 'auto' = detect from transcript. */
    language: 'auto' | 'en' | 'ru'
    /** When non-null, overrides the default `summary` role model. */
    modelOverride: string | null
  }
```

- [ ] **Step 2.3: Add defaults to `DEFAULT_SETTINGS`**

Inside `DEFAULT_SETTINGS` (right after `overlayAnswerMaxHeight: 320,`):

```ts
  recap: {
    autoGenerate: false,
    tone: 'concise',
    language: 'auto',
    modelOverride: null
  },
```

- [ ] **Step 2.4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. If a settings-migration helper exists somewhere (search for `migrateSettings` or `mergeWithDefaults`), confirm it deep-merges nested objects so existing users get the default `recap` block on load.

- [ ] **Step 2.5: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(settings): add recap.{autoGenerate,tone,language,modelOverride}"
```

---

## Task 3: Prompt builder

**Files:**
- Create: `src/main/services/recap/recapPrompt.ts`
- Create: `src/main/services/recap/recapPrompt.test.ts`

The builder must produce: a `system` string that instructs the model to output strict JSON matching the schema, and a `user` string holding the transcript + Q&A context. Pure function — no LLM call here.

- [ ] **Step 3.1: Write the failing test**

```ts
// src/main/services/recap/recapPrompt.test.ts
import { describe, expect, it } from 'vitest'
import { buildRecapPrompt, PROMPT_VERSION } from './recapPrompt.js'
import type { SessionDetailPayload } from '../../../shared/api.js'

const session: SessionDetailPayload = {
  id: 'abc',
  startedAt: 0,
  endedAt: 60_000,
  title: 'Q3 sync',
  segments: [
    { channel: 'mic', startMs: 0, text: 'Lets ship by July.' },
    { channel: 'system', startMs: 1000, text: 'Sounds good, Ill send the doc.' }
  ],
  exchanges: [],
  filePath: '/tmp/abc.json'
}

describe('buildRecapPrompt', () => {
  it('emits a system prompt that names every schema field', () => {
    const { system } = buildRecapPrompt(session, {})
    for (const key of ['tldr', 'decisions', 'actionItems', 'openQuestions', 'followUp']) {
      expect(system).toContain(key)
    }
    expect(system).toMatch(/JSON/i)
  })

  it('labels mic as You and system as Them in the transcript block', () => {
    const { user } = buildRecapPrompt(session, {})
    expect(user).toContain('[You] Lets ship by July.')
    expect(user).toContain('[Them] Sounds good, Ill send the doc.')
  })

  it('inserts tone hint when provided', () => {
    const { system } = buildRecapPrompt(session, { tone: 'friendly' })
    expect(system.toLowerCase()).toContain('friendly')
  })

  it('forces language when not auto', () => {
    const { system: en } = buildRecapPrompt(session, { language: 'en' })
    expect(en).toMatch(/respond in english/i)
    const { system: ru } = buildRecapPrompt(session, { language: 'ru' })
    expect(ru).toMatch(/respond in russian/i)
  })

  it('omits language instruction when auto', () => {
    const { system } = buildRecapPrompt(session, { language: 'auto' })
    expect(system).not.toMatch(/respond in (english|russian)/i)
  })

  it('exports a stable prompt version', () => {
    expect(PROMPT_VERSION).toBe(1)
  })

  it('handles empty exchanges gracefully', () => {
    const { user } = buildRecapPrompt({ ...session, exchanges: [] }, {})
    expect(user).not.toContain('<exchanges>')
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/recap/recapPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the builder**

```ts
// src/main/services/recap/recapPrompt.ts
import type { SessionDetailPayload } from '../../../shared/api.js'
import type { RecapOptions, RecapTone, RecapLanguage } from './recapSchema.js'

export const PROMPT_VERSION = 1

const TONE_HINT: Record<RecapTone, string> = {
  concise: 'Keep the follow-up draft concise — no fluff, no greetings beyond a one-line opener.',
  friendly: 'Make the follow-up draft warm and friendly while staying professional.',
  formal: 'Keep the follow-up draft formal, polished, and business-appropriate.'
}

const LANGUAGE_HINT: Record<Exclude<RecapLanguage, 'auto'>, string> = {
  en: 'Respond in English regardless of the transcript language.',
  ru: 'Respond in Russian regardless of the transcript language.'
}

export interface RecapPromptParts {
  system: string
  user: string
}

export function buildRecapPrompt(
  session: SessionDetailPayload,
  options: RecapOptions
): RecapPromptParts {
  const tone = options.tone ?? 'concise'
  const language = options.language ?? 'auto'

  const system = [
    'You are a meeting recap writer. Read the transcript and produce a structured recap.',
    'OUTPUT FORMAT: emit a single JSON object — no prose, no markdown fencing — that matches this schema:',
    '{',
    '  "tldr": string (1-2 sentences summarising the call),',
    '  "decisions": string[] (explicit decisions; empty array if none),',
    '  "actionItems": Array<{ "text": string, "owner": "you" | "them" | "unknown", "dueHint"?: string }>,',
    '  "openQuestions": string[] (anything left unresolved),',
    '  "followUp": { "subject": string, "body": string } | null',
    '}',
    'Rules: "you" = the user (mic channel). "them" = the other party (system channel).',
    'If the call has no obvious follow-up to send, set followUp to null.',
    'Match the transcript language unless instructed otherwise.',
    TONE_HINT[tone],
    language === 'auto' ? '' : LANGUAGE_HINT[language]
  ]
    .filter(Boolean)
    .join('\n')

  const transcriptLines = session.segments
    .map((s) => `[${s.channel === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n')

  const exchangeLines = session.exchanges
    .map((e) => `Q: ${e.prompt}\nA: ${e.answer}`)
    .join('\n\n')

  const userParts = [
    `<transcript>\n${transcriptLines || '(empty transcript)'}\n</transcript>`
  ]
  if (exchangeLines) {
    userParts.push(`<exchanges>\n${exchangeLines}\n</exchanges>`)
  }
  if (session.title) {
    userParts.push(`<meeting_title>${session.title}</meeting_title>`)
  }

  return { system, user: userParts.join('\n\n') }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/recap/recapPrompt.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3.5: Commit**

```bash
git add src/main/services/recap/recapPrompt.ts src/main/services/recap/recapPrompt.test.ts
git commit -m "feat(recap): pure prompt builder + PROMPT_VERSION"
```

---

## Task 4: Sidecar persistence

**Files:**
- Create: `src/main/services/recap/recapPersistence.ts`
- Create: `src/main/services/recap/recapPersistence.test.ts`

Atomic write means: write to `<id>.recap.json.tmp`, then `fs.rename` → final path. This avoids half-written files if the process crashes mid-write. Use `node:fs/promises`.

- [ ] **Step 4.1: Write the failing test**

```ts
// src/main/services/recap/recapPersistence.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRecap, writeRecap, deleteRecap } from './recapPersistence.js'
import type { RecapPayload } from './recapSchema.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zanban-recap-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const sample: RecapPayload = {
  schemaVersion: 1,
  tldr: 'hello',
  decisions: [],
  actionItems: [],
  openQuestions: [],
  followUp: null,
  generatedAt: 1700000000000,
  model: 'gemini-2.5-flash-lite',
  promptVersion: 1
}

describe('recapPersistence', () => {
  it('writes then reads the same payload', async () => {
    await writeRecap(dir, 'abc123', sample)
    const back = await readRecap(dir, 'abc123')
    expect(back).toEqual(sample)
  })

  it('returns null when file is missing', async () => {
    expect(await readRecap(dir, 'no-such-id')).toBeNull()
  })

  it('returns null and removes file when JSON is corrupt', async () => {
    await writeFile(join(dir, 'bad.recap.json'), '{ not json')
    expect(await readRecap(dir, 'bad')).toBeNull()
    // file should be cleaned up so the UI shows a clean empty state
    expect(await readRecap(dir, 'bad')).toBeNull()
  })

  it('returns null when payload fails schema validation', async () => {
    await writeFile(join(dir, 'bad2.recap.json'), JSON.stringify({ tldr: '' }))
    expect(await readRecap(dir, 'bad2')).toBeNull()
  })

  it('delete is idempotent', async () => {
    await deleteRecap(dir, 'never-existed') // no throw
    await writeRecap(dir, 'abc', sample)
    await deleteRecap(dir, 'abc')
    expect(await readRecap(dir, 'abc')).toBeNull()
    await deleteRecap(dir, 'abc') // second delete also no-throw
  })

  it('rejects invalid session ids', async () => {
    await expect(writeRecap(dir, '../etc', sample)).rejects.toThrow(/invalid session id/i)
    await expect(readRecap(dir, '../etc')).rejects.toThrow(/invalid session id/i)
  })

  it('atomic write leaves no .tmp file behind on success', async () => {
    await writeRecap(dir, 'abc', sample)
    const content = await readFile(join(dir, 'abc.recap.json'), 'utf8')
    expect(content.length).toBeGreaterThan(0)
    // Check no tmp file is lingering
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/recap/recapPersistence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement persistence**

```ts
// src/main/services/recap/recapPersistence.ts
import { readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { recapSchema, RECAP_SCHEMA_VERSION, type RecapPayload } from './recapSchema.js'

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function assertId(id: string): void {
  if (!SESSION_ID_RE.test(id)) throw new Error('invalid session id')
}

function recapPath(dir: string, id: string): string {
  return join(dir, `${id}.recap.json`)
}

export async function writeRecap(
  dir: string,
  id: string,
  payload: RecapPayload
): Promise<void> {
  assertId(id)
  const tmp = recapPath(dir, id) + '.tmp'
  const final = recapPath(dir, id)
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, final)
}

export async function readRecap(dir: string, id: string): Promise<RecapPayload | null> {
  assertId(id)
  const path = recapPath(dir, id)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    await safeUnlink(path)
    return null
  }

  const result = recapSchema.safeParse(parsedJson)
  if (!result.success) {
    await safeUnlink(path)
    return null
  }
  const meta = parsedJson as Record<string, unknown>
  return {
    ...result.data,
    schemaVersion: RECAP_SCHEMA_VERSION,
    generatedAt: typeof meta.generatedAt === 'number' ? meta.generatedAt : Date.now(),
    model: typeof meta.model === 'string' ? meta.model : 'unknown',
    promptVersion: typeof meta.promptVersion === 'number' ? meta.promptVersion : 0,
    partial: meta.partial === true ? true : undefined
  }
}

export async function deleteRecap(dir: string, id: string): Promise<void> {
  assertId(id)
  await safeUnlink(recapPath(dir, id))
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/recap/recapPersistence.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 4.5: Commit**

```bash
git add src/main/services/recap/recapPersistence.ts src/main/services/recap/recapPersistence.test.ts
git commit -m "feat(recap): atomic sidecar persistence + schema-validated read"
```

---

## Task 5: Replace `recapLlm.ts` with structured-output call

**Files:**
- Modify: `src/main/ai/llm/recapLlm.ts`
- Modify: `src/main/ai/llm/index.ts`

Current `recap(segments)` returns markdown string. We replace it with `generateRecap(session, options)` that returns `RecapResult`. Since no consumer of the old `recap()` exists (`grep` for `from.*llm/recap` finds nothing outside the index re-export), the change is safe.

- [ ] **Step 5.1: Rewrite `recapLlm.ts`**

```ts
// src/main/ai/llm/recapLlm.ts
import type { SessionDetailPayload } from '../../../shared/api.js'
import { generateOneShot } from './baseLlm.js'
import { modelFor } from '../models.js'
import {
  recapSchema,
  RECAP_SCHEMA_VERSION,
  type RecapOptions,
  type RecapPayload,
  type RecapResult
} from '../../services/recap/recapSchema.js'
import { buildRecapPrompt, PROMPT_VERSION } from '../../services/recap/recapPrompt.js'

const TIMEOUT_MS = 60_000

export async function generateRecap(
  session: SessionDetailPayload,
  options: RecapOptions
): Promise<RecapResult> {
  if (session.segments.length === 0) {
    return { ok: false, code: 'no_transcript', message: 'No transcript to summarise.' }
  }

  const { system, user } = buildRecapPrompt(session, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let raw: string
  try {
    raw = await generateOneShot({
      role: 'summary',
      system,
      prompt: user,
      temperature: 0.3,
      maxOutputTokens: 1500,
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    if (controller.signal.aborted) return { ok: false, code: 'timeout', message }
    if (/rate.*limit|429/i.test(message)) return { ok: false, code: 'rate_limit', message }
    if (/not configured|missing api key|no provider/i.test(message))
      return { ok: false, code: 'no_provider', message }
    return { ok: false, code: 'unknown', message }
  }
  clearTimeout(timer)

  const stripped = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    return { ok: false, code: 'invalid_output', message: 'Model did not return JSON.' }
  }

  const full = recapSchema.safeParse(parsed)
  if (full.success) {
    return {
      ok: true,
      recap: assemble(full.data, options.modelOverride ?? modelFor('summary'), false)
    }
  }

  // Partial-parse attempt: keep whatever the model managed to give us.
  const partial = recapSchema.partial({ tldr: false }).safeParse(parsed)
  if (partial.success && typeof (partial.data as Record<string, unknown>).tldr === 'string') {
    return {
      ok: false,
      code: 'invalid_output',
      message: 'Some recap sections could not be parsed.',
      partial: assemble(
        {
          tldr: (partial.data as { tldr: string }).tldr,
          decisions: (partial.data as { decisions?: string[] }).decisions ?? [],
          actionItems: (partial.data as { actionItems?: never[] }).actionItems ?? [],
          openQuestions: (partial.data as { openQuestions?: string[] }).openQuestions ?? [],
          followUp: (partial.data as { followUp?: never }).followUp ?? null
        },
        options.modelOverride ?? modelFor('summary'),
        true
      )
    }
  }

  return { ok: false, code: 'invalid_output', message: 'Output did not match schema.' }
}

function assemble(
  core: import('../../services/recap/recapSchema.js').RecapCore,
  model: string,
  partial: boolean
): RecapPayload {
  return {
    ...core,
    schemaVersion: RECAP_SCHEMA_VERSION,
    generatedAt: Date.now(),
    model,
    promptVersion: PROMPT_VERSION,
    ...(partial ? { partial: true } : {})
  }
}

function stripCodeFence(s: string): string {
  // Tolerate models that wrap JSON in ```json ... ``` despite the instruction.
  const trimmed = s.trim()
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }
  return trimmed
}
```

- [ ] **Step 5.2: Update `index.ts` re-export**

In `src/main/ai/llm/index.ts`:

```ts
export { generateOneShot } from './baseLlm.js'
export { clarify } from './clarifyLlm.js'
export { suggestFollowUps } from './followUpLlm.js'
export { generateRecap } from './recapLlm.js'
export { classifyIntent, type Intent } from './intentClassifier.js'
```

- [ ] **Step 5.3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5.4: Commit**

```bash
git add src/main/ai/llm/recapLlm.ts src/main/ai/llm/index.ts
git commit -m "feat(recap): structured-output LLM call with partial fallback"
```

---

## Task 6: `recapService` orchestrator

**Files:**
- Create: `src/main/services/recap/recapService.ts`
- Create: `src/main/services/recap/recapService.test.ts`

The service owns the public surface: `generateRecap`, `getRecap`, `deleteRecap`. It reads session data, calls the LLM helper, persists, and broadcasts via a callback (set by IPC layer). Guards against concurrent generation through an in-process Set keyed by `sessionId`.

- [ ] **Step 6.1: Write the failing test**

```ts
// src/main/services/recap/recapService.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRecapService } from './recapService.js'
import type { SessionDetailPayload } from '../../../shared/api.js'
import type { RecapResult } from './recapSchema.js'

const session: SessionDetailPayload = {
  id: 'sess1',
  startedAt: 0,
  endedAt: 1000,
  title: 'Test',
  segments: [
    { channel: 'mic', startMs: 0, text: 'hi' },
    { channel: 'system', startMs: 100, text: 'hello' }
  ],
  exchanges: [],
  filePath: '/tmp/sess1.json'
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zanban-recap-svc-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function okResult(): RecapResult {
  return {
    ok: true,
    recap: {
      schemaVersion: 1,
      tldr: 'they said hi',
      decisions: [],
      actionItems: [],
      openQuestions: [],
      followUp: null,
      generatedAt: 1,
      model: 'mock',
      promptVersion: 1
    }
  }
}

describe('recapService', () => {
  it('generates, persists, and emits update', async () => {
    const onUpdate = vi.fn()
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: onUpdate
    })
    const result = await svc.generate('sess1', {})
    expect(result.ok).toBe(true)
    expect(onUpdate).toHaveBeenCalledWith('sess1')
    const got = await svc.get('sess1')
    expect(got?.tldr).toBe('they said hi')
  })

  it('rejects concurrent generate for same id', async () => {
    let resolveLlm: (v: RecapResult) => void
    const llmPromise = new Promise<RecapResult>((r) => (resolveLlm = r))
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => llmPromise,
      onUpdated: () => undefined
    })
    const first = svc.generate('sess1', {})
    const second = await svc.generate('sess1', {})
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('already_generating')
    resolveLlm!(okResult())
    await first
  })

  it('returns no_transcript when session is missing', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => null,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    const result = await svc.generate('missing', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_transcript')
  })

  it('persists a partial result with partial:true', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => ({
        ok: false,
        code: 'invalid_output',
        message: 'partial',
        partial: { ...okResult().recap, partial: true }
      }),
      onUpdated: () => undefined
    })
    const result = await svc.generate('sess1', {})
    expect(result.ok).toBe(false)
    const got = await svc.get('sess1')
    expect(got?.partial).toBe(true)
  })

  it('delete removes the sidecar', async () => {
    const svc = createRecapService({
      dir,
      readSession: async () => session,
      llm: async () => okResult(),
      onUpdated: () => undefined
    })
    await svc.generate('sess1', {})
    await svc.delete('sess1')
    expect(await svc.get('sess1')).toBeNull()
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/recap/recapService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement the service**

```ts
// src/main/services/recap/recapService.ts
import type { SessionDetailPayload } from '../../../shared/api.js'
import {
  readRecap,
  writeRecap,
  deleteRecap as deleteRecapFile
} from './recapPersistence.js'
import type {
  RecapOptions,
  RecapPayload,
  RecapResult
} from './recapSchema.js'

export interface RecapServiceDeps {
  dir: string
  readSession: (id: string) => Promise<SessionDetailPayload | null>
  llm: (session: SessionDetailPayload, options: RecapOptions) => Promise<RecapResult>
  onUpdated: (sessionId: string) => void
}

export interface RecapService {
  generate(sessionId: string, options: RecapOptions): Promise<RecapResult>
  get(sessionId: string): Promise<RecapPayload | null>
  delete(sessionId: string): Promise<void>
  isGenerating(sessionId: string): boolean
}

export function createRecapService(deps: RecapServiceDeps): RecapService {
  const inFlight = new Set<string>()

  async function generate(sessionId: string, options: RecapOptions): Promise<RecapResult> {
    if (inFlight.has(sessionId)) {
      return {
        ok: false,
        code: 'already_generating',
        message: 'Recap generation is already running for this session.'
      }
    }
    const session = await deps.readSession(sessionId)
    if (!session || session.segments.length === 0) {
      return { ok: false, code: 'no_transcript', message: 'No transcript saved.' }
    }

    inFlight.add(sessionId)
    try {
      const result = await deps.llm(session, options)
      const toPersist =
        result.ok ? result.recap : result.partial ?? null
      if (toPersist) {
        await writeRecap(deps.dir, sessionId, toPersist)
        deps.onUpdated(sessionId)
      }
      return result
    } finally {
      inFlight.delete(sessionId)
    }
  }

  return {
    generate,
    get: (sessionId) => readRecap(deps.dir, sessionId),
    delete: async (sessionId) => {
      await deleteRecapFile(deps.dir, sessionId)
      deps.onUpdated(sessionId)
    },
    isGenerating: (sessionId) => inFlight.has(sessionId)
  }
}
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/recap/recapService.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6.5: Commit**

```bash
git add src/main/services/recap/recapService.ts src/main/services/recap/recapService.test.ts
git commit -m "feat(recap): service orchestrator with concurrency guard"
```

---

## Task 7: IPC channels + shared API types

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/api.ts`

- [ ] **Step 7.1: Add channels**

In `src/shared/ipc-channels.ts`, after the `jobs` block, add:

```ts
  recap: {
    generate: 'recap:generate',
    get: 'recap:get',
    delete: 'recap:delete',
    updated: 'recap:updated'
  }
```

(Keep the trailing `} as const`.)

- [ ] **Step 7.2: Add API surface**

In `src/shared/api.ts`, add to the imports:

```ts
import type {
  RecapOptions,
  RecapPayload,
  RecapResult
} from '../main/services/recap/recapSchema.js'
```

(If a renderer-side type import from `main/**` is disallowed by tsconfig path rules, instead **duplicate** the relevant types into `src/shared/recap-types.ts` and import from there in both places. Check `tsconfig.web.json` paths before deciding.)

Inside the `ZanbanApi` interface, after `jobs`, add:

```ts
  recap: {
    generate(sessionId: string, options?: RecapOptions): Promise<RecapResult>
    get(sessionId: string): Promise<RecapPayload | null>
    delete(sessionId: string): Promise<void>
    onUpdated(cb: (sessionId: string) => void): () => void
  }
```

- [ ] **Step 7.3: Decide on shared-types location**

Run: `cat F:/projects/zanban/tsconfig.web.json | head -40`
Decision rule: if the `paths` mapping forbids `@main/*` imports in the web build (which it usually does for safety), create `src/shared/recap-types.ts` re-exporting the necessary types, and import from `../../shared/recap-types.js` in both `recapSchema.ts` and `api.ts`. Otherwise import from `recapSchema.js` directly.

If you need to create `src/shared/recap-types.ts`, contents:

```ts
// src/shared/recap-types.ts
// Re-exported from the main-side schema so renderer/preload can type IPC
// without importing main code (which the web build path config forbids).
export type {
  RecapOptions,
  RecapPayload,
  RecapResult,
  RecapTone,
  RecapLanguage,
  RecapErrorCode
} from '../main/services/recap/recapSchema.js'
```

If this re-export still drags main code into the web bundle (because the source file uses `node:fs` etc. — it doesn't here, only `zod`), it's safe.

- [ ] **Step 7.4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/shared/ipc-channels.ts src/shared/api.ts src/shared/recap-types.ts 2>/dev/null || true
git add src/shared/ipc-channels.ts src/shared/api.ts
git commit -m "feat(recap): IPC channels + shared API types"
```

---

## Task 8: IPC handlers + preload bridge

**Files:**
- Create: `src/main/ipc/recap.ts`
- Modify: `src/main/index.ts` (register handlers + wire service)
- Modify: `src/preload/index.ts` (expose `window.zanban.recap`)

- [ ] **Step 8.1: Create IPC module**

```ts
// src/main/ipc/recap.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc-channels.js'
import {
  isValidSessionId,
  readSessionFromDisk
} from '../sync/sessionSync.js'
import { getSettings } from '../settings.js'
import { generateRecap as llmGenerateRecap } from '../ai/llm/recapLlm.js'
import { createRecapService, type RecapService } from '../services/recap/recapService.js'
import type { RecapOptions } from '../services/recap/recapSchema.js'

let service: RecapService | null = null
let registered = false

function broadcast(sessionId: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.recap.updated, sessionId)
  }
}

export function getRecapService(): RecapService {
  if (!service) {
    service = createRecapService({
      dir: join(app.getPath('userData'), 'sessions'),
      readSession: async (id) => (isValidSessionId(id) ? readSessionFromDisk(id) : null),
      llm: (session, options) => {
        const settings = getSettings()
        const merged: RecapOptions = {
          tone: options.tone ?? settings.recap.tone,
          language: options.language ?? settings.recap.language,
          modelOverride: options.modelOverride ?? settings.recap.modelOverride
        }
        return llmGenerateRecap(session, merged)
      },
      onUpdated: broadcast
    })
  }
  return service
}

export function registerRecapHandlers(): void {
  if (registered) return
  registered = true
  const svc = getRecapService()

  ipcMain.handle(IPC.recap.generate, async (_e, sessionId: unknown, options?: unknown) => {
    if (!isValidSessionId(sessionId)) {
      return { ok: false, code: 'no_transcript', message: 'Invalid session id.' }
    }
    return svc.generate(sessionId, (options ?? {}) as RecapOptions)
  })

  ipcMain.handle(IPC.recap.get, async (_e, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) return null
    return svc.get(sessionId)
  })

  ipcMain.handle(IPC.recap.delete, async (_e, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) return
    await svc.delete(sessionId)
  })
}
```

- [ ] **Step 8.2: Register in `src/main/index.ts`**

Find the place where other IPC modules register (search for `registerSessionsHandlers`). Add:

```ts
import { registerRecapHandlers } from './ipc/recap.js'
// ... inside whenReady / setup function, alongside the others:
registerRecapHandlers()
```

- [ ] **Step 8.3: Expose in preload**

Find `src/preload/index.ts`. Look for the section building `zanbanApi.sessions` / `zanbanApi.jobs`. Add:

```ts
recap: {
  generate: (sessionId, options) =>
    ipcRenderer.invoke(IPC.recap.generate, sessionId, options),
  get: (sessionId) => ipcRenderer.invoke(IPC.recap.get, sessionId),
  delete: (sessionId) => ipcRenderer.invoke(IPC.recap.delete, sessionId),
  onUpdated: (cb) => {
    const listener = (_e: unknown, sessionId: string): void => cb(sessionId)
    ipcRenderer.on(IPC.recap.updated, listener)
    return () => ipcRenderer.removeListener(IPC.recap.updated, listener)
  }
}
```

- [ ] **Step 8.4: Sanity build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. If `build` is slow, `pnpm typecheck` alone is enough; the dev server will catch the rest.

- [ ] **Step 8.5: Commit**

```bash
git add src/main/ipc/recap.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(recap): IPC handlers + preload bridge"
```

---

## Task 9: Auto-trigger on session stop

**Files:**
- Create: `src/main/services/recap/recapAutoTrigger.ts`
- Create: `src/main/services/recap/recapAutoTrigger.test.ts`
- Modify: `src/main/index.ts` (wire it)

Subscribe to the session-stop event, gate on `settings.recap.autoGenerate`, and call `recapService.generate` inside `jobsManager.trackJob` so progress is visible in `JobsBadge`. The actual session-event emitter is `sessionManager` in `src/main/transcription/sessionManager.ts` — read it first to confirm event name.

- [ ] **Step 9.1: Identify session-stop event hook**

Run: `grep -n "onState\|emit\|listener" F:/projects/zanban/src/main/transcription/sessionManager.ts | head -30`
Find an event/callback for "session ended" / "session stopped". If none exists, the easiest hook is to wrap `sessions.stop` in the IPC handler. Adjust the next step accordingly.

- [ ] **Step 9.2: Write the failing test (pure subscription logic)**

```ts
// src/main/services/recap/recapAutoTrigger.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createAutoTrigger } from './recapAutoTrigger.js'

describe('recapAutoTrigger', () => {
  it('does nothing when autoGenerate is off', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true })
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: false } } as never),
      generate,
      trackJob: async (_id, _t, _k, fn) => fn()
    })
    await trigger.onSessionStopped('sess1')
    expect(generate).not.toHaveBeenCalled()
  })

  it('invokes generate through trackJob when autoGenerate is on', async () => {
    const generate = vi.fn().mockResolvedValue({ ok: true })
    const trackJob = vi.fn(async (_id, _t, _k, fn) => fn())
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: true } } as never),
      generate,
      trackJob
    })
    await trigger.onSessionStopped('sess1')
    expect(trackJob).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith('sess1', {})
  })

  it('swallows generate errors so session-stop is not blocked', async () => {
    const trigger = createAutoTrigger({
      getSettings: () => ({ recap: { autoGenerate: true } } as never),
      generate: () => Promise.reject(new Error('boom')),
      trackJob: async (_id, _t, _k, fn) => fn()
    })
    await expect(trigger.onSessionStopped('sess1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 9.3: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/recap/recapAutoTrigger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9.4: Implement auto-trigger**

```ts
// src/main/services/recap/recapAutoTrigger.ts
import type { AppSettings } from '../../../shared/types.js'
import type { RecapResult } from './recapSchema.js'

export interface AutoTriggerDeps {
  getSettings: () => AppSettings
  generate: (sessionId: string) => Promise<RecapResult>
  trackJob: (
    id: string,
    title: string,
    kind: 'other',
    fn: () => Promise<unknown>
  ) => Promise<unknown>
}

export interface AutoTrigger {
  onSessionStopped(sessionId: string): Promise<void>
}

export function createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger {
  return {
    async onSessionStopped(sessionId: string): Promise<void> {
      const { autoGenerate } = deps.getSettings().recap
      if (!autoGenerate) return
      try {
        await deps.trackJob(
          `recap-${sessionId}`,
          'Generating meeting recap',
          'other',
          () => deps.generate(sessionId)
        )
      } catch {
        // Swallow — auto-trigger is best-effort. The user did not request
        // this explicitly, so surfacing a modal/toast would be noise.
        // jobsManager already marks it failed visually.
      }
    }
  }
}
```

- [ ] **Step 9.5: Wire it in `src/main/index.ts`**

Find the session-stop site identified in Step 9.1. Example wiring (concrete code depends on whether sessionManager exposes an event):

```ts
import { createAutoTrigger } from './services/recap/recapAutoTrigger.js'
import { trackJob } from './services/jobsManager.js'
import { getRecapService } from './ipc/recap.js'
import { getSettings } from './settings.js'

const autoTrigger = createAutoTrigger({
  getSettings,
  generate: (id) => getRecapService().generate(id, {}),
  trackJob
})

// Option A — sessionManager emits an event:
// sessionManager.on('stopped', (id: string) => void autoTrigger.onSessionStopped(id))

// Option B — hook the IPC stop handler. Inside the existing handler for
// IPC.session.stop, AFTER the stop completes, capture the sessionId that
// just ended and call:
//   void autoTrigger.onSessionStopped(stoppedId)
```

Pick whichever option matches the codebase. If neither is clean, add a one-liner emitter in `sessionManager` first (out of scope of this plan only if you keep it tiny).

- [ ] **Step 9.6: Run all recap tests + typecheck**

Run: `pnpm vitest run src/main/services/recap && pnpm typecheck`
Expected: PASS, 3 new tests + the previous 24.

- [ ] **Step 9.7: Commit**

```bash
git add src/main/services/recap/recapAutoTrigger.ts \
        src/main/services/recap/recapAutoTrigger.test.ts \
        src/main/index.ts
git commit -m "feat(recap): opt-in auto-trigger on session stop via jobsManager"
```

---

## Task 10: Renderer pure formatters

**Files:**
- Create: `src/renderer/src/features/sessions/recapActions.ts`
- Create: `src/renderer/src/features/sessions/recapActions.test.ts`

- [ ] **Step 10.1: Write the failing test**

```ts
// src/renderer/src/features/sessions/recapActions.test.ts
import { describe, expect, it } from 'vitest'
import {
  formatRecapAsMarkdown,
  formatFollowUpAsPlainText
} from './recapActions'
import type { RecapPayload } from '@shared/recap-types'

const recap: RecapPayload = {
  schemaVersion: 1,
  tldr: 'We aligned on Q3 scope.',
  decisions: ['Ship beta July 15'],
  actionItems: [
    { text: 'Send PRD', owner: 'you', dueHint: 'tomorrow' },
    { text: 'Review API contract', owner: 'them' }
  ],
  openQuestions: ['What about EU rollout?'],
  followUp: { subject: 'Q3 sync follow-up', body: 'Hi team,\n\nThanks for the call.' },
  generatedAt: 0,
  model: 'm',
  promptVersion: 1
}

describe('formatRecapAsMarkdown', () => {
  it('renders all sections', () => {
    const md = formatRecapAsMarkdown(recap)
    expect(md).toContain('# TL;DR')
    expect(md).toContain('We aligned on Q3 scope.')
    expect(md).toContain('## Decisions')
    expect(md).toContain('## Action items')
    expect(md).toContain('- (You) Send PRD — tomorrow')
    expect(md).toContain('- (Them) Review API contract')
    expect(md).toContain('## Open questions')
    expect(md).toContain('## Follow-up')
  })

  it('omits empty sections', () => {
    const md = formatRecapAsMarkdown({
      ...recap,
      decisions: [],
      openQuestions: [],
      followUp: null
    })
    expect(md).not.toContain('## Decisions')
    expect(md).not.toContain('## Open questions')
    expect(md).not.toContain('## Follow-up')
  })
})

describe('formatFollowUpAsPlainText', () => {
  it('returns subject + blank line + body', () => {
    const out = formatFollowUpAsPlainText(recap.followUp!)
    expect(out).toBe('Subject: Q3 sync follow-up\n\nHi team,\n\nThanks for the call.')
  })

  it('strips markdown emphasis', () => {
    const out = formatFollowUpAsPlainText({
      subject: 'Hello',
      body: '**Bold** and *italic* with [link](https://x)'
    })
    expect(out).toBe('Subject: Hello\n\nBold and italic with link')
  })
})
```

- [ ] **Step 10.2: Implement formatters**

```ts
// src/renderer/src/features/sessions/recapActions.ts
import type { RecapPayload } from '@shared/recap-types'

export function formatRecapAsMarkdown(recap: RecapPayload): string {
  const parts: string[] = []
  parts.push(`# TL;DR\n\n${recap.tldr}`)

  if (recap.decisions.length > 0) {
    parts.push(`## Decisions\n\n${recap.decisions.map((d) => `- ${d}`).join('\n')}`)
  }

  if (recap.actionItems.length > 0) {
    const lines = recap.actionItems.map((a) => {
      const owner = a.owner === 'you' ? 'You' : a.owner === 'them' ? 'Them' : '?'
      const due = a.dueHint ? ` — ${a.dueHint}` : ''
      return `- (${owner}) ${a.text}${due}`
    })
    parts.push(`## Action items\n\n${lines.join('\n')}`)
  }

  if (recap.openQuestions.length > 0) {
    parts.push(`## Open questions\n\n${recap.openQuestions.map((q) => `- ${q}`).join('\n')}`)
  }

  if (recap.followUp) {
    parts.push(
      `## Follow-up\n\n**Subject:** ${recap.followUp.subject}\n\n${recap.followUp.body}`
    )
  }

  return parts.join('\n\n')
}

export function formatFollowUpAsPlainText(followUp: { subject: string; body: string }): string {
  const body = stripMarkdown(followUp.body)
  return `Subject: ${followUp.subject}\n\n${body}`
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
}
```

- [ ] **Step 10.3: Run test to verify it passes**

Run: `pnpm vitest run src/renderer/src/features/sessions/recapActions.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10.4: Commit**

```bash
git add src/renderer/src/features/sessions/recapActions.ts \
        src/renderer/src/features/sessions/recapActions.test.ts
git commit -m "feat(recap): renderer-side markdown + plain-text formatters"
```

---

## Task 11: `RecapTab` component

**Files:**
- Create: `src/renderer/src/features/sessions/RecapTab.tsx`
- Create: `src/renderer/src/features/sessions/RecapTab.dom.test.tsx`

The component takes `session: SessionDetailPayload` (so it can check `segments.length` for the disabled state and pass it through if it needs anything else). It uses TanStack Query for the recap and subscribes to `window.zanban.recap.onUpdated` for invalidation. It does NOT generate inline — calls `window.zanban.recap.generate(...)` which already runs in main.

- [ ] **Step 11.1: Write DOM test (failing)**

```tsx
// src/renderer/src/features/sessions/RecapTab.dom.test.tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecapTab } from './RecapTab'
import type { SessionDetailPayload } from '@shared/api'
import type { RecapPayload } from '@shared/recap-types'

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
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecap({ followUp: null })
    )
    render(wrap(<RecapTab session={session} />))
    await screen.findByText('overall ok')
    expect(screen.queryByText(/follow-?up/i)).toBeNull()
  })

  it('shows partial badge when recap.partial is true', async () => {
    ;(zanban.recap.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRecap({ partial: true })
    )
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
    await findByText(/too many requests/i)
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/src/features/sessions/RecapTab.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 11.3: Implement the component**

```tsx
// src/renderer/src/features/sessions/RecapTab.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { StreamingMarkdown } from '@renderer/features/ai/StreamingMarkdown'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { PROMPT_VERSION } from '@shared/recap-types'
// PROMPT_VERSION is exported from main; if path rules forbid that, mirror
// the constant in shared/recap-types.ts and import from there.
import type { SessionDetailPayload } from '@shared/api'
import type { RecapPayload, RecapResult } from '@shared/recap-types'
import { formatRecapAsMarkdown, formatFollowUpAsPlainText } from './recapActions'
import { toast } from 'sonner'

export function RecapTab({ session }: { session: SessionDetailPayload }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const queryKey = ['recap', session.id]
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data: recap } = useQuery<RecapPayload | null>({
    queryKey,
    queryFn: () => window.zanban.recap.get(session.id)
  })

  useEffect(() => {
    return window.zanban.recap.onUpdated((sessionId) => {
      if (sessionId === session.id) qc.invalidateQueries({ queryKey })
    })
  }, [qc, queryKey, session.id])

  const generate = useMutation<RecapResult, Error>({
    mutationFn: () => window.zanban.recap.generate(session.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey })
      if (!result.ok) setErrorMessage(result.message)
      else setErrorMessage(null)
    },
    onError: (e) => setErrorMessage(e.message)
  })

  const remove = useMutation<void, Error>({
    mutationFn: () => window.zanban.recap.delete(session.id),
    onSuccess: () => qc.invalidateQueries({ queryKey })
  })

  if (!recap && generate.isPending) return <RecapSkeleton />

  if (!recap) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-4 px-1">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('session_detail.recap.empty_label')}
        </div>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {t('session_detail.recap.empty_blurb')}
        </p>
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || session.segments.length === 0}
          className="gap-2"
        >
          {generate.isPending && <Loader2 className="size-4 animate-spin" />}
          {t('session_detail.recap.generate')}
        </Button>
        {errorMessage && (
          <p className="text-[12px] text-destructive">{errorMessage}</p>
        )}
      </div>
    )
  }

  const outdated = recap.promptVersion !== PROMPT_VERSION

  return (
    <ScrollArea className="h-full pr-3">
      <div className="flex flex-col gap-5">
        <RecapHeader
          recap={recap}
          outdated={outdated}
          onRegenerate={() => generate.mutate()}
          onCopyAll={() => {
            void copyToClipboard(formatRecapAsMarkdown(recap), t('common.copied'))
          }}
          onDelete={() => {
            if (confirm(t('session_detail.recap.delete_confirm'))) remove.mutate()
          }}
          busy={generate.isPending || remove.isPending}
        />
        {recap.partial && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {t('session_detail.recap.partial_warning')}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {errorMessage}
          </div>
        )}

        <TldrCard text={recap.tldr} />

        {recap.actionItems.length > 0 && (
          <Section title={t('session_detail.recap.action_items', { count: recap.actionItems.length })}>
            <ActionList sessionId={session.id} items={recap.actionItems} />
          </Section>
        )}

        {recap.decisions.length > 0 && (
          <Section title={t('session_detail.recap.decisions')}>
            <BulletList items={recap.decisions} />
          </Section>
        )}

        {recap.openQuestions.length > 0 && (
          <Section title={t('session_detail.recap.open_questions')}>
            <BulletList items={recap.openQuestions} muted />
          </Section>
        )}

        {recap.followUp && (
          <FollowUpSection followUp={recap.followUp} />
        )}
      </div>
    </ScrollArea>
  )
}

function RecapHeader({
  recap,
  outdated,
  busy,
  onRegenerate,
  onCopyAll,
  onDelete
}: {
  recap: RecapPayload
  outdated: boolean
  busy: boolean
  onRegenerate(): void
  onCopyAll(): void
  onDelete(): void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {recap.model} · {relativeAge(recap.generatedAt)}
        {recap.partial && <span className="ml-2 text-amber-400">{t('session_detail.recap.partial_badge')}</span>}
        {outdated && <span className="ml-2 text-amber-400">{t('session_detail.recap.older_prompt')}</span>}
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onRegenerate} disabled={busy}>
          <RotateCcw className="size-3.5" /> {t('session_detail.recap.regenerate')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onCopyAll} disabled={busy}>
          <Copy className="size-3.5" /> {t('session_detail.recap.copy_all')}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onDelete} disabled={busy}>
          <Trash2 className="size-3.5" /> {t('session_detail.recap.delete')}
        </Button>
      </div>
    </div>
  )
}

function TldrCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[15px] leading-relaxed text-foreground/95">
      {text}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function BulletList({ items, muted = false }: { items: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-col gap-1 px-1">
      {items.map((it, i) => (
        <li
          key={i}
          className={cn(
            'text-[13px] leading-relaxed',
            muted ? 'text-muted-foreground' : 'text-foreground/90'
          )}
        >
          • {it}
        </li>
      ))}
    </ul>
  )
}

function ActionList({
  sessionId,
  items
}: {
  sessionId: string
  items: Array<{ text: string; owner: 'you' | 'them' | 'unknown'; dueHint?: string }>
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((a, i) => (
        <ActionItem key={i} sessionId={sessionId} index={i} item={a} />
      ))}
    </ul>
  )
}

function ActionItem({
  sessionId,
  index,
  item
}: {
  sessionId: string
  index: number
  item: { text: string; owner: 'you' | 'them' | 'unknown'; dueHint?: string }
}) {
  const storageKey = `recap-checked-${sessionId}-${index}`
  const [checked, setChecked] = useState<boolean>(
    () => localStorage.getItem(storageKey) === '1'
  )
  function toggle() {
    const next = !checked
    setChecked(next)
    if (next) localStorage.setItem(storageKey, '1')
    else localStorage.removeItem(storageKey)
  }
  const ownerLabel = item.owner === 'you' ? 'You' : item.owner === 'them' ? 'Them' : '?'
  const ownerColor =
    item.owner === 'you'
      ? 'text-blue-400 border-blue-500/40'
      : item.owner === 'them'
        ? 'text-orange-400 border-orange-500/40'
        : 'text-muted-foreground border-white/[0.08]'
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed">
      <input type="checkbox" checked={checked} onChange={toggle} className="mt-1.5" />
      <span
        className={cn(
          'mt-0.5 select-none rounded border px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider',
          ownerColor
        )}
      >
        {ownerLabel}
      </span>
      <span className={cn('flex-1', checked && 'line-through opacity-60')}>{item.text}</span>
      {item.dueHint && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {item.dueHint}
        </span>
      )}
    </li>
  )
}

function FollowUpSection({
  followUp
}: {
  followUp: { subject: string; body: string }
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-1 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('session_detail.recap.follow_up')}
        </span>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="mb-2 text-[13px] font-medium">{followUp.subject}</div>
          <div className="text-[13px] leading-relaxed text-foreground/90">
            <StreamingMarkdown text={followUp.body} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                void copyToClipboard(
                  `Subject: ${followUp.subject}\n\n${followUp.body}`,
                  t('common.copied')
                )
              }}
            >
              <Copy className="size-3.5" /> {t('session_detail.recap.copy_followup_md')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                void copyToClipboard(formatFollowUpAsPlainText(followUp), t('common.copied'))
              }}
            >
              <Copy className="size-3.5" /> {t('session_detail.recap.copy_followup_plain')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RecapSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-12 rounded-md bg-white/[0.04] animate-pulse" />
      <div className="flex flex-col gap-2">
        <div className="h-3 w-32 rounded bg-white/[0.04]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-full rounded bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function relativeAge(generatedAt: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - generatedAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(generatedAt).toLocaleDateString()
}
```

> **NB on PROMPT_VERSION import:** if the renderer can't import from `src/main/**`, add `export const PROMPT_VERSION = 1` to `src/shared/recap-types.ts` (mirror constant), and import from there in both renderer and `recapPrompt.ts`. Keep them in sync; the consequence of mismatch is just an outdated-badge false positive.

- [ ] **Step 11.4: Run DOM tests**

Run: `pnpm vitest run src/renderer/src/features/sessions/RecapTab.dom.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 11.5: Commit**

```bash
git add src/renderer/src/features/sessions/RecapTab.tsx \
        src/renderer/src/features/sessions/RecapTab.dom.test.tsx \
        src/shared/recap-types.ts 2>/dev/null || true
git add src/renderer/src/features/sessions/RecapTab.tsx \
        src/renderer/src/features/sessions/RecapTab.dom.test.tsx
git commit -m "feat(recap): RecapTab component + DOM tests"
```

---

## Task 12: Wire `SessionDetail` to use `RecapTab`

**Files:**
- Modify: `src/renderer/src/features/sessions/SessionDetail.tsx`

Replace the inline `SummaryTab` function and the `SUMMARY_LABEL` magic-string flow with a single `<RecapTab session={data} />`. The "Summary" tab in `TabSwitcher` becomes "Recap" (i18n key change in Task 14).

- [ ] **Step 12.1: Edit `SessionDetail.tsx`**

1. Add import at top:
   ```ts
   import { RecapTab } from './RecapTab'
   ```
2. Inside `SessionDetail`, change `type TabId = 'summary' | 'transcript' | 'usage'` → `type TabId = 'recap' | 'transcript' | 'usage'`.
3. Change default state `useState<TabId>('summary')` → `useState<TabId>('recap')`.
4. Update `TabSwitcher` `TABS` array: `{ id: 'recap' }` first.
5. Replace the `{tab === 'summary' && ...}` blocks (header actions + content) with:
   ```tsx
   {tab === 'recap' && <RecapTab session={data} />}
   ```
6. Delete `SUMMARY_LABEL`, `SummaryActions`, `SummaryTab`, and `generateSummary` functions entirely.
7. Remove now-unused imports: `RotateCcw`, `Copy`, `Check`, `useAi`, `StreamingMarkdown` if not used elsewhere in the file (the `ExchangeRow` keeps `StreamingMarkdown` — keep that import).

- [ ] **Step 12.2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Fix any leftover dangling imports.

- [ ] **Step 12.3: Commit**

```bash
git add src/renderer/src/features/sessions/SessionDetail.tsx
git commit -m "feat(recap): swap SummaryTab for RecapTab in SessionDetail"
```

---

## Task 13: Settings — Recap section

**Files:**
- Create: `src/renderer/src/features/settings/RecapSettingsTab.tsx`
- Modify: `src/renderer/src/features/settings/SettingsPanel.tsx`

Pattern follows existing `PersonasTab.tsx` / `ProvidersTab.tsx`. Read `SettingsPanel.tsx` first to see how the navigation list is structured.

- [ ] **Step 13.1: Read SettingsPanel to find the nav list shape**

Run: `grep -n "PersonasTab\|ProvidersTab\|nav" F:/projects/zanban/src/renderer/src/features/settings/SettingsPanel.tsx | head -30`
Identify how tabs are declared (string union? array of objects?). Apply the same pattern in step 13.3.

- [ ] **Step 13.2: Implement `RecapSettingsTab.tsx`**

```tsx
// src/renderer/src/features/settings/RecapSettingsTab.tsx
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from './store'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

const TONES = ['concise', 'friendly', 'formal'] as const
const LANGS = ['auto', 'en', 'ru'] as const

export function RecapSettingsTab() {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)
  const recap = settings.recap

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold">{t('settings.recap.title')}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {t('settings.recap.subtitle')}
        </p>
      </header>

      <Row label={t('settings.recap.auto_label')} hint={t('settings.recap.auto_hint')}>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={recap.autoGenerate}
            onChange={(e) => patch({ recap: { ...recap, autoGenerate: e.target.checked } })}
          />
          <span className="text-[13px]">{t('settings.recap.auto_toggle')}</span>
        </label>
      </Row>

      <Row label={t('settings.recap.tone_label')} hint={t('settings.recap.tone_hint')}>
        <div className="inline-flex gap-1 rounded-full border border-white/[0.06] p-1">
          {TONES.map((tone) => (
            <Button
              key={tone}
              size="sm"
              variant={recap.tone === tone ? 'default' : 'ghost'}
              className={cn('rounded-full px-3 text-[12px]')}
              onClick={() => patch({ recap: { ...recap, tone } })}
            >
              {t(`settings.recap.tones.${tone}`)}
            </Button>
          ))}
        </div>
      </Row>

      <Row label={t('settings.recap.language_label')} hint={t('settings.recap.language_hint')}>
        <select
          value={recap.language}
          onChange={(e) =>
            patch({ recap: { ...recap, language: e.target.value as typeof LANGS[number] } })
          }
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[13px]"
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {t(`settings.recap.languages.${l}`)}
            </option>
          ))}
        </select>
      </Row>

      <Row label={t('settings.recap.model_label')} hint={t('settings.recap.model_hint')}>
        <input
          type="text"
          value={recap.modelOverride ?? ''}
          placeholder={t('settings.recap.model_placeholder')}
          onChange={(e) =>
            patch({
              recap: { ...recap, modelOverride: e.target.value ? e.target.value : null }
            })
          }
          className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[13px]"
        />
      </Row>
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] font-medium">{label}</div>
      {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
      <div className="mt-1">{children}</div>
    </div>
  )
}
```

> **NB:** the exact `useSettingsStore` API (`settings`, `patch`) is the assumption based on the store file. Open `src/renderer/src/features/settings/store.ts` (one-line check) and adapt: if it exposes `setSettings(patch)` instead of `patch(...)`, swap the call name.

- [ ] **Step 13.3: Add the tab to SettingsPanel nav**

Following the pattern you read in 13.1, add an entry that renders `<RecapSettingsTab/>` under a label `t('settings.tabs.recap')`. Place it next to Personas or after Providers.

- [ ] **Step 13.4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
git add src/renderer/src/features/settings/RecapSettingsTab.tsx \
        src/renderer/src/features/settings/SettingsPanel.tsx
git commit -m "feat(recap): settings tab (autoGenerate / tone / language / model)"
```

---

## Task 14: i18n keys (EN + RU)

**Files:**
- Modify: `src/shared/locales/en.json`
- Modify: `src/shared/locales/ru.json`

- [ ] **Step 14.1: Add EN keys**

Add to `en.json` (merge into existing groups; preserve other keys):

```json
{
  "session_detail": {
    "tabs": { "recap": "Recap" },
    "recap": {
      "empty_label": "no recap yet",
      "empty_blurb": "Generate an AI recap with action items and a ready-to-send follow-up. Uses the saved transcript only — no audio is re-sent.",
      "generate": "Generate recap",
      "regenerate": "Regenerate",
      "copy_all": "Copy as Markdown",
      "delete": "Delete",
      "delete_confirm": "Delete this recap? You can always regenerate.",
      "action_items_one": "Action items · 1",
      "action_items_other": "Action items · {{count}}",
      "decisions": "Decisions",
      "open_questions": "Open questions",
      "follow_up": "Follow-up draft",
      "copy_followup_md": "Copy",
      "copy_followup_plain": "Copy as plain text",
      "partial_badge": "partial",
      "partial_warning": "Some sections couldn't be parsed and are missing. Regenerate to retry.",
      "older_prompt": "older prompt — regenerate to refresh"
    }
  },
  "settings": {
    "tabs": { "recap": "Recap" },
    "recap": {
      "title": "Post-meeting recap",
      "subtitle": "How structured recaps are generated after a session ends.",
      "auto_label": "Auto-generate",
      "auto_hint": "Generate a recap automatically when you stop a session. Uses your selected LLM provider — leave off if you'd rather control when API calls happen.",
      "auto_toggle": "Generate recap on session stop",
      "tone_label": "Tone",
      "tone_hint": "Applied to the follow-up draft body.",
      "tones": { "concise": "Concise", "friendly": "Friendly", "formal": "Formal" },
      "language_label": "Language",
      "language_hint": "'Auto' matches the transcript language.",
      "languages": { "auto": "Auto", "en": "English", "ru": "Russian" },
      "model_label": "Model override",
      "model_hint": "Leave empty to use the default summary-role model.",
      "model_placeholder": "e.g. gemini-2.5-flash-lite"
    }
  }
}
```

- [ ] **Step 14.2: Remove old `session_detail.tabs.summary` and related keys**

Search for `"summary"` under `session_detail.tabs` in `en.json` and remove that key. Also remove any orphan `session_detail.summary_*` keys (run `grep -n "summary" src/shared/locales/en.json` first).

- [ ] **Step 14.3: Mirror in RU**

Apply matching Russian translations to `src/shared/locales/ru.json` under the same paths. Don't forget the diacritics. Example:

```json
"recap": {
  "title": "Резюме встречи",
  "subtitle": "Как формируется структурированное резюме после окончания сессии."
}
```

(Full RU strings: write proper Russian translations for every key added in 14.1.)

- [ ] **Step 14.4: Verify locale parity**

Run: `node -e "const a=Object.keys(require('./src/shared/locales/en.json').settings.recap||{}); const b=Object.keys(require('./src/shared/locales/ru.json').settings.recap||{}); console.log(a.filter(k=>!b.includes(k))); console.log(b.filter(k=>!a.includes(k)));"`
Expected: both arrays empty.

- [ ] **Step 14.5: Commit**

```bash
git add src/shared/locales/en.json src/shared/locales/ru.json
git commit -m "i18n(recap): keys for RecapTab + settings (EN + RU)"
```

---

## Task 15: Manual smoke + final pass

**Files:** none (verification only).

- [ ] **Step 15.1: Run full test suite + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, zero failures. If anything in `prompts.test.ts` references the old `recap()` shape, update accordingly (search for `recap` in test files: `grep -rn "from.*llm/recap\|generateRecap\b" src`).

- [ ] **Step 15.2: Boot the app**

Run: `pnpm dev`
Steps:
1. Start a session, speak ~30 seconds (mic + system if possible).
2. Stop the session.
3. Open the session in the dashboard → Recap tab.
4. Click `Generate recap`.
5. Confirm: TL;DR appears, action items list with owner chips, decisions, follow-up draft.
6. Click `Regenerate` — recap updates.
7. Click `Copy as Markdown` — paste into a text editor, confirm structure.
8. Restart the app — recap should still be there (sidecar persisted).
9. Settings → Recap → toggle `Auto-generate on stop` ON.
10. Run another short session, stop it. Within ~10s, `JobsBadge` shows the job, and the recap tab populates automatically.

- [ ] **Step 15.3: Verify error paths manually**

1. Settings → Providers — clear API key. Click `Generate recap`. Expected: red banner with a readable message (`no_provider`).
2. Restore API key. Open `DevTools` → `Application` → `Local Storage` and clear any `recap-checked-*` keys to verify checkboxes still work.

- [ ] **Step 15.4: Final commit**

If any tweaks were needed during smoke (typos in i18n, layout shift):

```bash
git add -p
git commit -m "fix(recap): smoke-test follow-ups"
```

If clean, skip the commit.

- [ ] **Step 15.5: Optional — push branch**

```bash
git push -u origin HEAD
```

---

## Self-Review (final)

**1. Spec coverage:** Walked through every spec section.

- Triggers (manual button + opt-in auto) → Tasks 6, 9, 11, 13.
- Sidecar persistence → Task 4.
- Structured output via schema → Tasks 1, 5.
- Concurrency guard → Task 6.
- Renderer empty/loading/populated/error/partial/outdated states → Task 11 (all six states have tests).
- Settings (autoGenerate / tone / language / modelOverride) → Tasks 2, 13.
- i18n (EN + RU) → Task 14.
- Error codes (rate_limit / timeout / no_provider / invalid_output / no_transcript / already_generating) → Tasks 1 (codes), 5 (LLM mapping), 6 (concurrency), 11 (UI).
- Tests listed in spec all mapped to concrete `.test.*` files in Tasks 1, 3, 4, 6, 9, 10, 11.

**2. Placeholder scan:** No "TBD/TODO/implement later". Two "TBD by reading the file" instructions remain (Step 9.1 — sessionManager event identification; Step 13.1 — SettingsPanel nav shape). Both have concrete next-step guidance for the executor. Acceptable because the right answer depends on file layout, not on judgement.

**3. Type consistency check:**
- `RecapPayload`, `RecapResult`, `RecapOptions`, `RecapErrorCode` — defined once in Task 1, used identically across Tasks 5, 6, 7, 10, 11.
- `generateRecap` (Task 5) signature `(session, options) => Promise<RecapResult>` matches `createRecapService` `deps.llm` signature in Task 6.
- `window.zanban.recap.generate(sessionId, options?)` — Task 7 / Task 8 / Task 11 all use the same `(string, RecapOptions?)` shape.
- `PROMPT_VERSION` — single source (Task 3), referenced in Task 5 and Task 11.
- `recap` settings field — Task 2 defines shape, Tasks 8, 13 read from `settings.recap.*`.

**4. Ambiguity check:**
- Renderer-side import of `PROMPT_VERSION` / recap types: covered with the `src/shared/recap-types.ts` mirror file fallback (Step 7.3).
- Session-stop event hook (Step 9.1): explicit "read the file first" instruction.
- `useSettingsStore` shape (Step 13.2): "verify and swap" instruction included.

Plan is self-consistent.
