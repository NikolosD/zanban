# Post-meeting Recap: structured summary + action items + follow-up draft

Дата: 2026-05-20
Контекст: апгрейд существующего `SummaryTab` в `SessionDetail`. Сейчас саммари — unstructured-markdown bullets, хранится только в in-memory zustand-сторе `useAi` под магическим лейблом `__zanban_session_summary__`. После перезапуска приложения исчезает. Нет action items, нет разделения «Я / Они», нет follow-up draft, нет автогенерации на окончание сессии. Закрываем loop «слушали → отвечали → что дальше».

## Цель

После завершения встречи пользователь должен получить структурированный документ-резюме, который:

1. Показывает TL;DR за 1–2 предложения.
2. Перечисляет decisions, action items с владельцем (You/Them/Unknown), open questions.
3. Содержит готовый follow-up draft (subject + body), который можно скопировать одним кликом.
4. Сохраняется на диск и доступен после перезапуска приложения.
5. Может генерироваться автоматически при остановке сессии — opt-in через Settings.

Фича живёт в существующем `SessionDetail`. Никаких новых окон, никаких новых pillars. UI-сurface — переименование `SummaryTab` → `RecapTab` и расширение его содержимым.

## Решения по поведению

| Решение                          | Выбор                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Триггер генерации                | Кнопка «Generate recap» в RecapTab + опционально авто при session-stop          |
| Default автогенерации            | **Off** — opt-in, чтобы не палить API без согласия пользователя                 |
| Источник данных                  | Сохранённый transcript (`session.segments`) + Q&A (`session.exchanges`)         |
| Хранение                         | Sidecar `<sessionId>.recap.json` рядом с основным session-файлом                |
| Структурированный output         | `generateObject` из ai-sdk + zod-схема; fallback на JSON-парс для провайдеров без structured output |
| Локальные «выполнено» для action | Чекбоксы в UI — local storage по ключу `sessionId+itemIndex`, без синков наружу |
| Редактирование recap             | Не редактируем в UI — только regenerate; для правок копируешь наружу            |
| Outdated-индикация               | `promptVersion` в payload, при апгрейде промпта в коде показываем «outdated, regenerate?» |
| Concurrent generate              | Guard через JobsStore — повторный запрос отвечает «already generating»          |

## Архитектура

```
session.stop ──(opt-in)──┐
                          ├──► RecapService.generateRecap(sessionId, options)
RecapTab "Generate" ──────┘            │
                                       ▼
                          buildRecapPrompt(session, options)
                                       │
                                       ▼
                          ai-sdk generateObject(recapSchema)
                                       │
                                       ▼
                          validate + persist sidecar
                                       │
                                       ▼
                          IPC push → SessionDetail RecapTab refresh
```

### Main process

`src/main/services/recap/`

- **`recapService.ts`** — оркестратор:

  ```ts
  generateRecap(sessionId: string, options?: RecapOptions): Promise<RecapResult>
  getRecap(sessionId: string): Promise<RecapPayload | null>
  deleteRecap(sessionId: string): Promise<void>
  ```

  `RecapResult = { ok: true, recap: RecapPayload } | { ok: false, code: RecapErrorCode, message: string, partial?: Partial<RecapPayload> }`.

  Внутри: читает session через существующий sessions-store, строит prompt, дёргает ai-sdk, валидирует Zod-схемой, пишет sidecar, эмитит IPC-событие `recap:updated`.

- **`recapPrompt.ts`** — чистая функция `buildRecapPrompt(session, options): { system: string, user: string }`. Тестируется без LLM.

- **`recapSchema.ts`** — Zod-схема (см. ниже). Экспортирует `recapSchema` и тип `RecapPayload`.

- **`recapPersistence.ts`** — `readSidecar(sessionId)`, `writeSidecar(sessionId, recap)`, `deleteSidecar(sessionId)`. Файлы лежат в той же папке, что и session-файлы (`app.getPath('userData')/sessions/<id>.recap.json`). Атомарная запись через tmp + rename.

- **`recapAutoTrigger.ts`** — подписывается на session-stop event. Читает `settings.recap.autoGenerate`. Если true — регистрирует job в `src/main/services/jobsManager.ts` (он уже есть), который и зовёт `recapService.generateRecap`. Не блокирует stop-flow.

### IPC

В `@shared/api` добавляем:

```ts
recap: {
  generate(sessionId: string, options?: RecapOptions): Promise<RecapResult>
  get(sessionId: string): Promise<RecapPayload | null>
  delete(sessionId: string): Promise<void>
  onUpdated(handler: (sessionId: string) => void): () => void
}
```

`recap.generate` идемпотентна: если в `jobsManager` уже есть pending-job для этого `sessionId`, возвращает `{ ok: false, code: 'already_generating' }`.

### Renderer

- `src/renderer/src/features/sessions/RecapTab.tsx` — заменяет inline-функцию `SummaryTab` внутри `SessionDetail.tsx`. Данные через TanStack Query `['recap', sessionId]`, инвалидация по IPC-событию `recap:updated`.
- `src/renderer/src/features/sessions/recapActions.ts` — мелкие хелперы: `formatRecapAsMarkdown(recap)`, `formatFollowUpAsPlainText(recap.followUp)`. Чистые, тестируемые.
- Удаляем магический лейбл `__zanban_session_summary__` и старую функцию `generateSummary` из `SessionDetail.tsx`.
- В таб-свитчере `session_detail.tabs.summary` → `session_detail.tabs.recap` (i18n).

## Данные

### Zod-схема (`recapSchema.ts`)

```ts
const recapItemSchema = z.object({
  text: z.string().min(1),
  owner: z.enum(['you', 'them', 'unknown']).default('unknown'),
  dueHint: z.string().optional()
})

const followUpSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1)
}).nullable()

export const recapSchema = z.object({
  tldr: z.string().min(1),
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(recapItemSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  followUp: followUpSchema
})

export type RecapPayload = z.infer<typeof recapSchema> & {
  generatedAt: number
  model: string
  promptVersion: number
  partial?: boolean
}
```

### RecapOptions

```ts
type RecapOptions = {
  tone?: 'concise' | 'friendly' | 'formal'
  language?: 'auto' | 'en' | 'ru'
  modelOverride?: string
}
```

Если поле не передано — берётся из settings.

### Sidecar файл

`<userData>/sessions/<sessionId>.recap.json`:

```json
{
  "schemaVersion": 1,
  "tldr": "...",
  "decisions": ["..."],
  "actionItems": [{ "text": "...", "owner": "you", "dueHint": "by Friday" }],
  "openQuestions": ["..."],
  "followUp": { "subject": "...", "body": "..." },
  "generatedAt": 1715958000000,
  "model": "gemini-2.5-flash-lite",
  "promptVersion": 1,
  "partial": false
}
```

## UI

### RecapTab layout (сверху вниз)

1. **Header bar** — справа: `Regenerate`, `Copy as Markdown`, overflow-меню с `Delete recap`. Слева: метка `model · "5 sec ago" · partial badge если partial=true`.

2. **TL;DR card** — крупно, акцентная карточка, `text-[15px]`, верхний край панели.

3. **Action items section** — заголовок «Action items · N», список. Каждая строка:
   - Локальный чекбокс (state в `localStorage` под `recap-checked-<sessionId>-<index>`).
   - Owner-чип слева: `You` синий, `Them` оранжевый, `?` серый — переиспользуем цвета из `SegmentLine`.
   - Текст; справа мелкий `dueHint` серым, если есть.
   - Пустой массив → секция скрыта.

4. **Decisions section** — bullets. Скрыто, если пусто.

5. **Open questions section** — bullets серым. Скрыто, если пусто.

6. **Follow-up draft section** — collapsible. По умолчанию свёрнут (чтобы экран не был перегружен). Внутри:
   - Subject строкой.
   - Body как markdown через `StreamingMarkdown`.
   - Две кнопки: `Copy` (markdown) и `Copy as plain text`.
   - Скрыта целиком, если `followUp === null`.

### Состояния

- **Empty (no recap saved)** — текущий empty-state из `SummaryTab` (`no summary yet`) → `no recap yet`. CTA `Generate recap`, hint «Tip: enable auto-recap in Settings». Кнопка disabled, если `session.segments.length === 0`.

- **Loading (generating)** — skeleton по форме секций: серая полоса для TL;DR, 3 строки скелетона для action items, 2 для decisions. Не общий spinner — пользователь должен понимать форму ожидаемого результата.

- **Error** — красный banner сверху с reason и кнопкой Retry. Если есть `partial` payload — секции с распарсенным контентом рендерятся ниже banner-а.

- **Outdated (promptVersion mismatch)** — желтоватый badge возле header «Recap was generated with an older prompt — regenerate to refresh».

## Settings

Новая секция в `SettingsPanel` — `Recap` (рядом с Personas / ReferenceDocs). Поля:

| Setting key                    | Type                                  | Default            | UI                                  |
| ------------------------------ | ------------------------------------- | ------------------ | ----------------------------------- |
| `recap.autoGenerate`           | `boolean`                             | `false`            | Toggle с пояснением про opt-in/API  |
| `recap.tone`                   | `'concise' \| 'friendly' \| 'formal'` | `'concise'`        | Radio-group                         |
| `recap.language`               | `'auto' \| 'en' \| 'ru'`              | `'auto'`           | Select                              |
| `recap.modelOverride`          | `string \| null`                      | `null` (use текущую default-модель AskPanel из providers-settings) | Select из existing-providers' моделей |

i18n-ключи добавляем в namespace `settings.recap.*`.

## Промпт

`buildRecapPrompt(session, options)` собирает:

- **system**: правила формата, инструкция «output strict JSON matching the provided schema», tone, language.
- **user**: `<transcript>` (segments в формате `[You]/[Them] text`), `<exchanges>` (Q&A), список participants («mic = the user, system = the other party»), optional «previous user-edited follow-up: …» — на будущее, сейчас не используется.

`promptVersion = 1` в коде в `recapPrompt.ts` как const. Bump'аем вручную при изменении промпта.

## Error handling

| Ситуация                          | Поведение                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| LLM rate-limit                    | `{ ok: false, code: 'rate_limit' }`, UI показывает «Provider rate-limited, retry in a moment»     |
| Timeout (≥60s)                    | `{ ok: false, code: 'timeout' }`, UI: «Took too long. Try a smaller model or shorter transcript.» |
| No provider configured            | `{ ok: false, code: 'no_provider' }`, toast с deeplink в Providers tab                            |
| Schema validation fail            | Пытаемся `recapSchema.partial().safeParse`. Если есть `tldr` — сохраняем как `partial: true`. Если нет — `{ ok: false, code: 'invalid_output' }` |
| Пустой transcript                 | Кнопка Generate disabled, нет IPC-вызова                                                          |
| Concurrent generate same session  | `{ ok: false, code: 'already_generating' }` — UI остаётся в loading-state                         |
| Auto-trigger при stop падает      | Логируем, отмечаем job как failed в `jobsManager` (видно через `JobsBadge`). Без модалок и тостов — пользователь это не запрашивал явно |
| Старый sidecar поврежден (bad JSON) | Лог + удаляем + UI показывает empty-state с кнопкой Generate                                      |

## Tests

| Файл                                       | Что покрывает                                                       |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `recapPrompt.test.ts`                      | snapshot для типичного transcript + tone/language вариаций          |
| `recapSchema.test.ts`                      | валид / невалид / partial parse                                     |
| `recapPersistence.test.ts`                 | write → read round-trip, delete, atomic write через tmp             |
| `recapService.test.ts`                     | mock ai-sdk, проверяем full pipeline + все error-коды               |
| `recapAutoTrigger.test.ts`                 | settings off → ничего; settings on → job в JobsService             |
| `RecapTab.dom.test.tsx`                    | empty / loading / populated / error / partial / no-followUp / outdated |
| `recapActions.test.ts`                     | `formatRecapAsMarkdown`, `formatFollowUpAsPlainText`                |

Без e2e — у проекта их нет, не вводим. Existing test-runner — vitest + happy-dom + testing-library.

## Что НЕ делаем (YAGNI)

- Не синкаем action items с внешними todo-системами (Todoist, Linear, etc.).
- Не парсим даты из `dueHint` — храним как строку.
- Не делаем coach-фидбэк по ответам пользователя — это отдельная фича, отдельный спек.
- Не редактируем recap руками в UI — только regenerate.
- Не делаем «recap-only mode» в overlay — это исключительно post-session, в дашборде.
- Не делаем экспорт в PDF — у тебя уже есть `ExportPdfButton` для всей сессии, его не трогаем; следующим шагом можно включить recap-секции в PDF, но это отдельная задача.
- Не делаем «multi-language recap» (одновременно EN и RU) — одна сессия, один язык.

## Совместимость / миграции

- Старый `SummaryTab` и магический лейбл `__zanban_session_summary__` удаляются. Тех, у кого summary висел в памяти, ничего не теряют — он был эфемерный.
- `promptVersion = 1` стартует с этой версии.
- `schemaVersion = 1` в sidecar. При будущем bump'е добавим миграцию или просто отметим как outdated.
- i18n: новые ключи `session_detail.tabs.recap`, `session_detail.recap.*`, `settings.recap.*`. Старый `session_detail.tabs.summary` удаляется.

## Open questions перед имплементацией

Ни одного — все решения зафиксированы в таблицах выше. При несогласии правим этот спек до перехода к `writing-plans`.
