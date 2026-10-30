import { describe, it, expect, vi } from 'vitest'
import type { TranscriptSegment } from '../../shared/types.js'
import { createMlTasks } from '../ml/tasks.js'
import { DEFAULT_DISTANCE_THRESHOLD, selectHits } from './ragRetriever.js'
import { chunkSegments, chunkText } from './semanticChunker.js'
import { cleanSegments } from './transcriptCleaner.js'
import type { RetrievedChunk } from './vectorStore.js'

// ragRetriever → vectorStore → db imports electron, whose binary isn't
// installed when CI runs `pnpm install --ignore-scripts`.
vi.mock('electron', () => ({ app: {} }))

// Opt-in: loads the real encoder (downloaded on first run into node_modules/.cache).
// Run with `RAG_EVAL=1 pnpm vitest run src/main/rag/retrievalEval.test.ts`.
const ENABLED = process.env.RAG_EVAL === '1'

// Measured with the pinned encoder. Raise when retrieval improves; a drop fails.
// meanUnrelatedPerQuery and smallTalkMaxInjected are ceilings (lower them when
// retrieval improves) that no run of the encoder has measured yet; tighten them
// to the first real run.
const BASELINE = {
  recallAt6: 1,
  selectedRecall: 1,
  offTopicHits: 0,
  meanUnrelatedPerQuery: 1,
  smallTalkMaxInjected: 1
}

// The production search over-fetches this many times k before selecting.
const K = 6
const OVERFETCH = 3

type Turn = ['You' | 'Them', string]

const CALLS: Record<string, Turn[]> = {
  'salary-ru': [
    ['Them', 'Какие у вас ожидания по зарплате?'],
    ['You', 'Рассчитываю примерно на триста тысяч рублей в месяц на руки, обсуждаемо.']
  ],
  'salary-en': [
    ['Them', 'What are your salary expectations for this role?'],
    ['You', "I'm targeting around 140k base, flexible depending on equity."]
  ],
  'deadline-ru': [
    ['Them', 'Когда планируем релиз мобильного приложения?'],
    ['You', 'Цель — конец марта, но интеграцию с платёжным шлюзом могут сдвинуть на апрель.']
  ],
  'pricing-en': [
    ['Them', 'The enterprise tier is 49 dollars per seat per month, 15 percent off annual plans.'],
    ['You', 'Does that include SSO?'],
    ['Them', 'SSO is an add-on for larger teams.']
  ],
  'security-en': [
    ['Them', 'We had an incident last month where an API key leaked in a public repo.'],
    ['You', 'We should rotate keys and add secret scanning to CI.']
  ],
  'onboarding-ru': [
    ['Them', 'Сколько длится онбординг новых сотрудников?'],
    ['You', 'Обычно две недели: сначала доступы и документация, потом первая задача с ментором.']
  ],
  'kubernetes-en': [
    ['You', 'Our deployment runs on Kubernetes with Helm charts, autoscaling based on CPU.'],
    ['Them', 'Have you considered KEDA for queue-based scaling?']
  ],
  'churn-ru': [
    ['Them', 'Отток клиентов вырос до семи процентов за квартал.'],
    ['You', 'Основная причина — долгий ответ поддержки, мы вводим SLA в четыре часа.']
  ],
  'marketing-en': [
    ['Them', 'The LinkedIn campaign brought 300 leads but conversion to demo was only 4 percent.']
  ],
  'weather-ru': [
    ['Them', 'Как у вас погода? У нас снег идёт второй день.'],
    ['You', 'Здесь тепло, плюс пятнадцать.']
  ],
  'weekend-en': [
    ['Them', 'How was your weekend?'],
    ['You', 'Pretty relaxed, went hiking with the kids.']
  ],
  'budget-ru': [
    ['You', 'Бюджет на маркетинг в следующем квартале — два миллиона рублей.'],
    ['Them', 'Из них половину направим на контекстную рекламу.']
  ],
  'testing-en': [
    ['You', 'We cover payments with integration tests, but end-to-end tests are flaky on CI.'],
    ['Them', 'Maybe run them nightly instead of on every PR.']
  ],
  'relocation-ru': [
    ['Them', 'Готовы ли вы к релокации в Белград?'],
    ['You', 'Да, рассматриваю переезд, если компания поможет с визой.']
  ],
  'remote-en': [
    ['Them', 'Is the role fully remote?'],
    ['You', "I'd prefer remote with occasional trips to the office once a quarter."]
  ],
  'perf-en': [
    ['Them', 'The dashboard takes 8 seconds to load.'],
    ['You', 'Mostly an N plus one query in the reports endpoint; caching gets it under a second.']
  ],
  'standup-ru': [
    ['You', 'Вчера закончил ревью пулл-реквеста по авторизации, сегодня займусь уведомлениями.']
  ],
  'hardest-task-ru': [
    ['Them', 'Расскажите о своей самой сложной задаче.'],
    ['You', 'Переписал систему биллинга без простоя, мигрировав данные двух миллионов человек.']
  ],
  'weakness-en': [
    ['Them', "What's your biggest weakness?"],
    ['You', 'I sometimes over-engineer early prototypes, so now I timebox spikes to two days.']
  ],
  'partner-en': [
    ['Them', "We'd like to integrate your API into our CRM and resell it to our clients."],
    ['You', "Let's set up a partner agreement with revenue sharing."]
  ],
  'ml-ru': [
    ['Them', 'Какая точность у модели классификации обращений?'],
    ['You', 'Около девяноста двух процентов на тестовой выборке, хуже всего с доставкой.']
  ],
  'incident-ru': [
    ['Them', 'Вчера упал продакшен на сорок минут.'],
    ['You', 'Причина — переполнение диска на сервере базы данных, добавили алерты.']
  ]
}

const DOCS: Record<string, string> = {
  'postgres-recap':
    'Summary: Team agreed to migrate analytics from MongoDB to Postgres.\nDecisions: use Postgres 16; ship migration by Q3\nAction items: You — draft migration plan (Friday); Them — benchmark queries',
  'hiring-recap-ru':
    'Summary: Обсудили найм двух бэкенд-разработчиков.\nDecisions: открыть вакансии на Go; бюджет согласован\nAction items: You — написать описание вакансии (до пятницы)',
  'vendor-recap-ru':
    'Summary: Выбрали подрядчика для дизайна сайта.\nDecisions: студия «Пиксель»; срок — шесть недель\nOpen questions: кто отвечает за тексты?',
  'resume-doc':
    'Senior Frontend Engineer, 7 years of experience with React, TypeScript and design systems. Led migration of a monolith to micro-frontends at Acme Corp.',
  'vacation-doc-ru':
    'Отпуск сотрудника составляет 28 календарных дней в году. Заявление на отпуск подаётся не позднее чем за две недели до начала.',
  'contract-doc':
    'The Service Provider shall deliver monthly uptime reports. Either party may terminate this agreement with 30 days written notice.',
  'api-doc-ru':
    'Для авторизации запросов к API используйте заголовок Authorization с токеном Bearer. Токен действует 24 часа.',
  'office-doc':
    'Office hours are 9 to 6. The kitchen is on the third floor; parking passes are issued by reception.'
}

const QUERIES: Array<[query: string, expected: string]> = [
  ['Какую зарплату я назвал?', 'salary-ru'],
  ['Когда релиз мобильного приложения?', 'deadline-ru'],
  ['Сколько дней отпуска положено?', 'vacation-doc-ru'],
  ['Как долго длится онбординг?', 'onboarding-ru'],
  ['Почему вырос отток клиентов?', 'churn-ru'],
  ['Какой бюджет на маркетинг?', 'budget-ru'],
  ['Как авторизоваться в API?', 'api-doc-ru'],
  ['Что решили насчёт найма разработчиков?', 'hiring-recap-ru'],
  ['Почему упал прод?', 'incident-ru'],
  ['Готов ли я переехать в другую страну?', 'relocation-ru'],
  ['What salary did I ask for?', 'salary-en'],
  ['How much does the enterprise plan cost?', 'pricing-en'],
  ['What did we decide about the database migration?', 'postgres-recap'],
  ['How many years of React experience do I have?', 'resume-doc'],
  ['What happened with the leaked API key?', 'security-en'],
  ['How can we terminate the contract?', 'contract-doc'],
  ['Why is the dashboard slow?', 'perf-en'],
  ['What did I say my weakness was?', 'weakness-en'],
  ['What is the accuracy of the classification model?', 'ml-ru'],
  ['Какая конверсия была у кампании в LinkedIn?', 'marketing-en'],
  ['Which design agency did we choose?', 'vendor-recap-ru'],
  ['Это удалённая работа?', 'remote-en']
]

const OFF_TOPIC = [
  'Как приготовить борщ?',
  'Who won the football world cup in 2018?',
  'Сколько лет Эйфелевой башне?',
  'What is the capital of Australia?',
  'Посоветуй хороший фильм на вечер',
  'How do I fix a flat bicycle tire?'
]

// What "Answer last" searches for when the other speaker asked nothing: their
// last 60 words, here pleasantries and call logistics with no topic in them.
const SMALL_TALK = [
  "Hi everyone, thanks for joining. Can you all hear me okay? Great, perfect. Let's give it another minute or two for people to hop on. No rush at all, I'm just going to grab some water real quick. Okay, looks like most folks are here, so thanks again for making the time today.",
  "Yeah, no worries, totally understand. Sure, that works for me. Sounds good, thanks so much. Appreciate it. Okay, cool, let me just share my screen. Can you see it? Awesome. Alright, give me one second, I think my connection dropped for a moment there. Okay, I'm back, sorry about that.",
  "Right, right, absolutely. Mm-hmm, yeah, I hear you. That makes sense, thank you. Okay, great, I think we're all set then. Thanks everybody, have a good one, talk soon. Bye now, see you next time, take care.",
  'Всем привет, спасибо, что нашли время. Меня хорошо слышно? Отлично, замечательно. Давайте подождём ещё пару минут, пока все подключатся. Никуда не торопимся, я пока налью воды. Так, вроде почти все на месте, ещё раз спасибо, что пришли сегодня.',
  'Да, конечно, без проблем, понимаю. Хорошо, меня это устраивает. Отлично, большое спасибо. Так, сейчас покажу экран. Вам видно? Супер. Секунду, у меня на мгновение пропала связь. Всё, я снова с вами, извините за паузу.',
  'Ага, понятно, совершенно верно. Угу, я вас услышал. Это логично, спасибо. Хорошо, тогда, кажется, всё. Спасибо всем, хорошего дня, до скорой встречи. Пока, до связи, всего доброго.'
]

function corpus(): Array<{ source: string; kind: RetrievedChunk['sourceKind']; text: string }> {
  const out: Array<{ source: string; kind: RetrievedChunk['sourceKind']; text: string }> = []
  for (const [source, turns] of Object.entries(CALLS)) {
    const segments: TranscriptSegment[] = turns.map(([who, text], i) => ({
      id: `${source}-${i}`,
      channel: who === 'You' ? 'mic' : 'system',
      speaker: 0,
      startMs: i * 1000,
      endMs: i * 1000,
      text,
      isFinal: true,
      createdAt: i * 1000
    }))
    for (const c of chunkSegments(cleanSegments(segments))) {
      out.push({ source, kind: 'session', text: c.text })
    }
  }
  for (const [source, text] of Object.entries(DOCS)) {
    for (const c of chunkText(text, 0)) out.push({ source, kind: 'doc', text: c.text })
  }
  return out
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}

// sqlite-vec ranks by L2; on unit vectors that is sqrt(2 - 2·cos).
function l2(cos: number): number {
  return Math.sqrt(Math.max(0, 2 - 2 * cos))
}

describe.skipIf(!ENABLED)('retrieval eval', () => {
  it('keeps recall, noise and small-talk injection within the committed baseline', async () => {
    const tasks = createMlTasks('node_modules/.cache/zanban-rag-eval/models')
    const embedder = { embed: (texts: string[]) => tasks.run({ kind: 'embed', texts }) }
    const chunks = corpus()
    const vectors = await embedder.embed(chunks.map((c) => c.text))
    const rank = async (query: string): Promise<RetrievedChunk[]> => {
      const [q] = await embedder.embed([query])
      return chunks
        .map(
          (c, i): RetrievedChunk => ({
            id: i,
            sourceKind: c.kind,
            sourceId: c.source,
            sourceLabel: null,
            speaker: null,
            ts: 0,
            text: c.text,
            distance: l2(cosine(q!, vectors[i]!))
          })
        )
        .sort((a, b) => a.distance - b.distance)
    }
    const inject = (ranked: RetrievedChunk[]): RetrievedChunk[] =>
      selectHits(ranked.slice(0, K * OVERFETCH), K, DEFAULT_DISTANCE_THRESHOLD)

    let found = 0
    let selectedFound = 0
    let unrelated = 0
    for (const [query, expected] of QUERIES) {
      const ranked = await rank(query)
      if (ranked.slice(0, K).some((h) => h.sourceId === expected)) found++
      const injected = inject(ranked)
      if (injected.some((h) => h.sourceId === expected)) selectedFound++
      unrelated += injected.filter((h) => h.sourceId !== expected).length
    }
    let offTopicHits = 0
    for (const query of OFF_TOPIC) {
      if (inject(await rank(query)).length > 0) offTopicHits++
    }
    let smallTalkMaxInjected = 0
    for (const tail of SMALL_TALK) {
      smallTalkMaxInjected = Math.max(smallTalkMaxInjected, inject(await rank(tail)).length)
    }

    const metrics = {
      recallAt6: found / QUERIES.length,
      selectedRecall: selectedFound / QUERIES.length,
      offTopicHits,
      meanUnrelatedPerQuery: unrelated / QUERIES.length,
      smallTalkMaxInjected
    }
    const report = JSON.stringify(metrics)
    expect(metrics.recallAt6, report).toBeGreaterThanOrEqual(BASELINE.recallAt6)
    expect(metrics.selectedRecall, report).toBeGreaterThanOrEqual(BASELINE.selectedRecall)
    expect(metrics.offTopicHits, report).toBeLessThanOrEqual(BASELINE.offTopicHits)
    expect(metrics.meanUnrelatedPerQuery, report).toBeLessThanOrEqual(
      BASELINE.meanUnrelatedPerQuery
    )
    expect(metrics.smallTalkMaxInjected, report).toBeLessThanOrEqual(BASELINE.smallTalkMaxInjected)
  }, 600_000)
})
