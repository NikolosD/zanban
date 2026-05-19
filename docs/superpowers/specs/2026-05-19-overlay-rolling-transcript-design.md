# Overlay: rolling transcript line with inline question highlight

Дата: 2026-05-19
Контекст: добавляем видимую транскрипцию в оверлей-окно, чтобы пользователь понимал, на что ответит кнопка «Ответить». Референс — `RollingTranscript` из `F:/projects/natively-cluely-ai-assistant/src/components/ui/RollingTranscript.tsx`.

## Цель

В оверлее (`src/renderer/src/windows/overlay/OverlayApp.tsx`) сейчас не видно потока речи собеседника. Кнопка «Ответить» через `decideAnswerAction` выбирает либо последний `pending`-вопрос из `useQuestions`, либо фоллбэк по хвосту транскрипта — но пользователю не показано, какой именно текст послужит контекстом ответа. Сигнал «вот это будет ответ» сейчас даёт только мелкий чип с `↵` в нижнем блоке панели, который появляется не всегда и легко теряется.

Цель: показать в оверлее живую ленту речи собеседника (system-канал) и прямо в этой ленте подсвечивать детектированный вопрос, на который ответит кнопка. Один индикатор «вижу, что слышим → вижу, на что нажму».

## Решения по поведению

| Решение                            | Выбор                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Что показывать                     | Только `system`-канал                                              |
| Расположение                       | Отдельная плавающая пилюля между `StatusBar` и основной панелью    |
| Связь с вопросом                   | Подсветка детектированного вопроса прямо в ленте; нижний чип убираем |
| Содержимое                         | Однострочная бегущая лента финалов через ` · ` + partial серым в хвосте |
| Видимость                          | Только при `session.kind === 'running'`                            |
| Поведение подсветки после ответа   | Гасится: `text-primary` → `text-foreground/45`, без underline      |

## Архитектура

### Новый презентационный компонент

`src/renderer/src/windows/overlay/RollingTranscript.tsx`

```tsx
export function RollingTranscript(): JSX.Element | null
```

Без пропсов — компонент сам читает нужные слайсы стора (`useTranscript`, `useQuestions`, `useSettingsStore`). Это держит OverlayApp тонким и не плодит prop-drilling, а селекторы Zustand минимизируют ре-рендеры до изменения нужных полей.

Возвращает `null`, когда `session.kind !== 'running'`. Это убирает пилюлю из layout-flow целиком, и `setContentHeight` в `OverlayApp` пересчитает высоту окна через существующий `ResizeObserver`.

### Чистая функция сборки ленты

`src/renderer/src/windows/overlay/rollingLane.ts`

```ts
export interface LaneItem {
  id: string
  text: string
  isFinal: boolean
  highlight: 'none' | 'pending' | 'resolved'
}

export interface BuildLaneArgs {
  finals: TranscriptSegment[]        // только system-канал; фильтрация снаружи
  partial: TranscriptSegment | null  // partials.system
  questions: DetectedQuestion[]
  autoDetectQuestions: boolean       // settings.autoDetectQuestions ?? true
  limit?: number                     // сколько последних финалов держать, дефолт 40
}

export function buildLane(args: BuildLaneArgs): LaneItem[]
```

Правила:

- Финалы → `LaneItem[]` в порядке создания, обрезаются до `limit` последних.
- Для каждого финала: если `autoDetectQuestions` и есть `q` с `q.id === seg.id`, то `highlight = q.status === 'pending' ? 'pending' : 'resolved'` (и `answered`, и `dismissed` → `resolved`). Иначе `'none'`.
- Partial добавляется в хвост как `LaneItem { isFinal: false, highlight: 'none' }`, только если есть текст.

Эта функция — основной носитель логики и единственное место, где тестируется маппинг segment→question. UI-компонент остаётся тонким враппером.

### Изменения в `OverlayApp.tsx`

1. В layout `panelRef`-контейнера, между `StatusBar` и merged-панелью, вставляется `<RollingTranscript />`. `panelRef` уже навешен на внешний `flex-col gap-1.5 max-w-[680px]`-див, который оборачивает и `StatusBar`, и merged-панель — поэтому ResizeObserver автоматически подхватит высоту новой пилюли и пересчитает `setContentHeight`. Никаких структурных перестановок не нужно.
2. Удаляем блок `pendingQuestions.length > 0 && settings?.autoDetectQuestions !== false` вместе с рендером чипов (`pendingQuestions.map(...)`).
3. `hasContent` теряет ветку `pendingQuestions` — упрощаем до `hasHistory || apiKeysMissing || transcriptionError`.
4. Логика `decideAnswerAction` и `useQuestions.markAnswered` — без изменений. Подсветка в ленте автоматически переключится на `'resolved'`, потому что `markAnswered` обновит статус вопроса в сторе.

### Визуальные детали

Контейнер пилюли:

```
mx-auto flex w-full max-w-[680px] items-center gap-2
rounded-full border border-white/10
bg-black/55 px-3 py-1 backdrop-blur-2xl backdrop-saturate-150 shadow-xl
```

Внутри:

- Иконка-маркер слева (опционально маленький `Mic`/`Ear` от lucide) — `size-3 text-muted-foreground`. Решение: используем `Ear`, чтобы отличать от микрофонного канала.
- Скролл-контейнер: `flex-1 min-w-0 overflow-x-hidden whitespace-nowrap text-[12px] leading-6 text-foreground/85 italic`.
- Маска: `mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent)` через inline-style.
- Pulse-dot справа: `size-1.5 rounded-full bg-emerald-400/70 animate-pulse`, виден всегда, пока пилюля видна (сессия идёт). Простой индикатор «слушаю» — не пытаемся отличать «сейчас говорит» от «пауза».

Подсветка элементов:

- `highlight === 'pending'` → `text-primary` (без bold, без bg — лента должна оставаться текстом, а не плашкой).
- `highlight === 'resolved'` → `text-foreground/45`.
- `highlight === 'none'` → `text-foreground/85`.
- Partial → `text-muted-foreground/70` курсивом, после него мини-курсор `▍`.

Разделитель: между LaneItem-ами рендерим неинтерактивный `<span className="text-muted-foreground/30 px-1">·</span>`.

Авто-скролл: `useEffect` по `[laneSignature]`, где `laneSignature` — конкатенация id и длины partial-текста. На каждое изменение `el.scrollLeft = el.scrollWidth`. Если пользователь поскроллил вручную влево — пока что игнорируем (нет необходимости в "stick to bottom" поведении для этой первой версии; можно добавить позже по ощущениям).

### Поведение `data-interactive`

Пилюля должна быть в pointer-events-active области (чтобы скроллить колесом / тачпадом), поэтому ставим `data-interactive` на корневой `div` пилюли. Никаких кликабельных элементов внутри пока нет — действие происходит через `ActionChipsRow.Answer`.

## Поток данных

```
DeepgramStreamingSTT → main → IPC ('segment') → useTranscript.pushSegment
                                                  │
                                                  ├─ финал system           → finals[]
                                                  ├─ partial system         → partials.system
                                                  └─ if extractable         → useQuestions.push (после LLM extractor)

RollingTranscript:
  selectors:
    finals.filter(channel==='system')
    partials.system
    questions
    settings.autoDetectQuestions
    session.kind === 'running'
  →  buildLane(args)  →  render items with highlight class
```

Никаких новых IPC-каналов или main-side изменений не требуется. Это чисто renderer-фича поверх уже существующих сторов.

## Edge cases

- **Сессия только что стартовала**: `finals=[]`, `partial=null`. Пилюля видна, внутри только pulse-dot. Это нормально — даёт пользователю понять, что слушаем.
- **`autoDetectQuestions === false`**: подсветок нет, все финалы рендерятся `text-foreground/85`. Кнопка «Ответить» уходит в фоллбэк `ANSWER_LAST_PROMPT` — это уже текущее поведение `decideAnswerAction`, не трогаем.
- **Пользователь сам отвечает (mic-канал)**: `pushSegment` уже автоматически вызывает `markAnswered` для последнего pending-вопроса (в `store.ts:71-78`). Подсветка соответствующего сегмента в ленте сразу переключается на `resolved` — даёт визуальный сигнал «оно засекло, что ты ответил».
- **LLM extractor возвращает другой текст**: вопрос в `useQuestions` хранит cleaned-текст (`{...candidate, text: cleaned}`), но `id` совпадает с `seg.id`. Подсветка работает по id, а в ленте показывается оригинальный `seg.text` — не путаем пользователя «двумя версиями».
- **Очень длинная история сессии**: `finals` ограничены `MAX_FINALS = 500` сверху в сторе; в ленте ещё дополнительно режем до `limit = 40` последних, чтобы не лагал DOM при бесконечной прокрутке внутри маски.
- **Mic-канал**: вообще не рендерим в этой ленте. Это осознанное решение по результатам брейнсторма (см. таблицу решений).

## Тесты

`src/renderer/src/windows/overlay/rollingLane.test.ts`:

- finals-only без вопросов → все `highlight: 'none'`.
- финал с матчем по id, статус `pending` → `highlight: 'pending'`.
- финал с матчем по id, статус `answered` → `highlight: 'resolved'`.
- финал с матчем по id, статус `dismissed` → `highlight: 'resolved'`.
- `autoDetectQuestions=false` + матч есть → все `highlight: 'none'`.
- partial без текста не добавляется; partial с текстом добавляется в хвост, `isFinal: false`.
- `limit` обрезает старые финалы, не трогает partial.

`src/renderer/src/windows/overlay/RollingTranscript.test.tsx` (RTL + jsdom):

- `session.kind = 'idle'` → компонент возвращает `null` (рендера нет).
- `session.kind = 'running'` + финал system → текст рендерится.
- `session.kind = 'running'` + финал system + вопрос pending по тому же id → элемент имеет класс с `text-primary`.
- После `markAnswered(id)` → класс меняется на `text-foreground/45`.
- финал mic-канала не попадает в ленту.

## Что не делаем (нерасширение скоупа)

- Stick-to-bottom поведение при ручной прокрутке — не нужно, лента и так короткая (`limit=40`) и пользователь обычно не скроллит её руками.
- Click-to-answer прямо по подсвеченному сегменту — кнопка «Ответить» остаётся единственным способом. Меньше путей — меньше путаницы.
- Поддержка mic-канала с метками `You`/`Them` — это есть в дашбордовом `LiveTranscript`, в оверлее не нужно.
- Поддержка `dismiss` UI — у нас сейчас и так нет UI для dismiss в оверлее; всё происходит автоматически в сторе.
- Подгон ширины пилюли под содержимое (адаптивная) — берём фиксированную `max-w-[680px]` как у основной панели, для визуальной когерентности.

## Acceptance

1. При запущенной сессии в оверлее появляется горизонтальная узкая пилюля с бегущей речью собеседника.
2. Когда extractor добавляет вопрос в `useQuestions` со статусом `pending`, соответствующий сегмент в ленте окрашивается в primary.
3. После клика «Ответить» (или авто-`markAnswered` от mic-канала) подсветка гасится — сегмент становится тусклым.
4. Старый блок чипов pending-вопросов в нижней части merged-панели отсутствует.
5. Высота оверлей-окна корректно адаптируется под наличие/отсутствие пилюли (нет клиппинга, нет лишнего space).
6. Юнит-тесты `rollingLane.test.ts` и компонентные тесты `RollingTranscript.test.tsx` зелёные.
