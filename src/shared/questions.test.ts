import { describe, expect, it } from 'vitest'
import {
  findQuestion,
  lastQuestion,
  lastSystemFinal,
  questionKey,
  systemSpeechSince
} from './questions.js'
import type { TranscriptSegment } from './types.js'

function seg(
  id: string,
  text: string,
  channel: TranscriptSegment['channel'] = 'system'
): TranscriptSegment {
  return { id, text, channel, speaker: 0, startMs: 0, endMs: 0, isFinal: true, createdAt: 0 }
}

const ENGLISH_QUESTIONS = [
  'What is your experience with React?',
  'Can you walk me through your resume?',
  'Tell me about yourself?',
  'Why did you leave your last job?',
  'Do you have any questions for us?',
  'Would you mind sharing your screen?',
  'Which framework would you choose?',
  'Who is responsible for deployments?',
  'And how long did that project take?',
  "Um, so, what's the difference between a process and a thread?",
  'You worked at Google before, right?',
  'WHAT IS YOUR NAME',
  'What is a closure?!',
  'He asked: "Why is the sky blue?"',
  'Great, thanks for joining. What’s your current role?',
  'how does the event loop work',
  'How many years of experience do you have',
  "What's your biggest weakness",
  'Where do you see yourself in five years',
  'Have you worked with Kubernetes before',
  'Is the cache invalidated on write',
  'Does it scale horizontally',
  'Okay, so what database would you pick for this',
  'How about we start with your background',
  'What programming languages do you know'
]

const ENGLISH_NOT_QUESTIONS = [
  'Thanks for joining us today.',
  'Let me know if you have any questions',
  'I wonder how this works',
  'What I like about this role is the team.',
  'What I like about this role is the team',
  'When we get there we will see',
  'What a great day',
  'Have a good one',
  'Will do.',
  'Can’t wait to get started',
  'We use Kubernetes for orchestration and Terraform for everything else.',
  'What is a closure? Let’s move on.',
  'How does the event loop work. I will explain it later.',
  'Interesting. And why?',
  'So, I was thinking about the budget…'
]

const ENGLISH_TOO_SHORT_OR_FILLER = [
  'Okay?',
  'ok?',
  'Right?',
  'Really?',
  'Why?',
  'Why not?',
  'And you?',
  'Um, ok, right?',
  'So, yeah?',
  'Um, so, yeah, right?',
  'Hmm, well, okay?',
  'You know?',
  'Is it?',
  'what is 2+2?',
  'What’s your name?'
]

const ENGLISH_SMALL_TALK = [
  'Can you hear me?',
  'Okay, can you hear me okay?',
  'Can you see my screen?',
  'Do you hear me?',
  'Does that make sense?',
  'Is that clear?',
  'You know what I mean?',
  'Do you follow what I mean?',
  'Are you still there?',
  'How are you doing today?',
  "How's it going?",
  "How's your day going?"
]

const RUSSIAN_QUESTIONS = [
  'Расскажите, какой у вас опыт работы с React?',
  'Почему вы ушли с прошлой работы?',
  'Что такое замыкание в JavaScript?',
  'Где вы видите себя через пять лет?',
  'Ну а как вы решаете конфликты в команде?',
  'Есть ли у вас вопросы к нам?',
  'Вы работали с Docker?',
  'Спасибо, что пришли. Чем занимались на прошлой работе?',
  'Какой у вас опыт работы с Kubernetes',
  'Сколько лет вы работаете в индустрии',
  'Работали ли вы с микросервисами',
  'Можете рассказать про ваш последний проект',
  'Как вы относитесь к переработкам',
  'Зачем вам эта вакансия',
  'Неужели вы никогда не ошибались',
  'КАКОЙ У ВАС ОПЫТ РАБОТЫ',
  'Ну, э-э, и как вы это тестируете?'
]

const RUSSIAN_NOT_QUESTIONS = [
  'Спасибо, что пришли на встречу.',
  'Как я уже говорил, мы используем Kubernetes',
  'Что ж, давайте начнём',
  'Когда мы говорим о масштабировании',
  'Как правило, мы деплоим по пятницам',
  'Что-то не так с сервером',
  'Что касается нашего стека',
  'Расскажу немного о компании.',
  'Мы работаем над платёжной системой.'
]

const RUSSIAN_TOO_SHORT_OR_FILLER = [
  'Да?',
  'Ок?',
  'Правда?',
  'Ну да?',
  'А почему?',
  'Угу, ладно?',
  'Что дальше?',
  'Как дела?'
]

const RUSSIAN_SMALL_TALK = [
  'Меня слышно?',
  'Вы меня слышите?',
  'Видно мой экран?',
  'Вам всё понятно?',
  'Как у вас дела?',
  'Вы ещё на связи?',
  'Вы меня понимаете?'
]

describe('findQuestion', () => {
  it.each([...ENGLISH_QUESTIONS, ...RUSSIAN_QUESTIONS])('detects "%s"', (text) => {
    expect(findQuestion(text)).not.toBeNull()
  })

  it.each([...ENGLISH_NOT_QUESTIONS, ...RUSSIAN_NOT_QUESTIONS])('ignores "%s"', (text) => {
    expect(findQuestion(text)).toBeNull()
  })

  it.each([...ENGLISH_TOO_SHORT_OR_FILLER, ...RUSSIAN_TOO_SHORT_OR_FILLER])(
    'ignores the filler or very short "%s"',
    (text) => {
      expect(findQuestion(text)).toBeNull()
    }
  )

  it.each([...ENGLISH_SMALL_TALK, ...RUSSIAN_SMALL_TALK])(
    'ignores the call check-in "%s"',
    (text) => {
      expect(findQuestion(text)).toBeNull()
    }
  )

  it('returns only the last sentence, where the question is', () => {
    expect(findQuestion('Great, thanks for joining. What is your name?')).toBe('What is your name?')
    expect(findQuestion('Спасибо, что пришли. Чем занимались на прошлой работе?')).toBe(
      'Чем занимались на прошлой работе?'
    )
  })

  it('splits sentences after an ellipsis too', () => {
    expect(findQuestion('Well... what is your plan for the first month?')).toBe(
      'what is your plan for the first month?'
    )
  })

  it('keeps the words as spoken, trimmed', () => {
    expect(findQuestion('  So, what do you think about microservices?  ')).toBe(
      'So, what do you think about microservices?'
    )
  })

  it('trusts a closing period over a question-word opener', () => {
    expect(findQuestion('How does the event loop work.')).toBeNull()
    expect(findQuestion('How does the event loop work?')).not.toBeNull()
  })

  it('trusts a question mark over a statement-like opener', () => {
    expect(findQuestion('You worked at Google before, right?')).not.toBeNull()
    expect(findQuestion('Your last job was in Berlin?')).not.toBeNull()
  })

  it('does not take an earlier question when the last sentence is a statement', () => {
    expect(findQuestion('What is your experience with React? Take your time please.')).toBeNull()
  })

  it.each([[''], ['   '], ['?'], ['???'], ['😀😀😀'], ['...'], ['2 + 2?'], ['\n\t']])(
    'returns null for %j',
    (text) => {
      expect(findQuestion(text)).toBeNull()
    }
  )

  it('does not choke on a very long utterance', () => {
    const monologue = 'we ship small changes every day and review them together '.repeat(1000)
    const started = performance.now()
    expect(findQuestion(monologue)).toBeNull()
    expect(findQuestion(`${monologue} so what is your experience with that?`)).not.toBeNull()
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('does not choke on long runs of whitespace', () => {
    expect(findQuestion(`${' '.repeat(50_000)}what is your name${' '.repeat(50_000)}`)).toBe(
      'what is your name'
    )
  })
})

describe('findQuestion and lastQuestion', () => {
  const punctuated = [...ENGLISH_QUESTIONS, ...RUSSIAN_QUESTIONS].filter((q) => /\?\W*$/.test(q))

  it.each(punctuated)('pick the same question out of "%s"', (text) => {
    expect(findQuestion(text)).toBe(lastQuestion(text))
  })

  it('pick the same question when it follows other sentences', () => {
    const speech = 'Thanks for joining. We are hiring a backend engineer. What drew you to Zanban?'
    expect(findQuestion(speech)).toBe('What drew you to Zanban?')
    expect(lastQuestion(speech)).toBe('What drew you to Zanban?')
  })
})

describe('lastQuestion', () => {
  it('is the last sentence that asks and has enough words', () => {
    expect(lastQuestion('What is your name? Why did you apply? Right?')).toBe('Why did you apply?')
  })

  it('is null when nothing asks, or asks too briefly', () => {
    expect(lastQuestion('We ship daily. Why not?')).toBeNull()
    expect(lastQuestion('')).toBeNull()
  })
})

describe('questionKey', () => {
  it('treats punctuation, case and leading fillers as the same question', () => {
    const key = questionKey('Can you tell me about React?')
    expect(questionKey('can you tell me about react')).toBe(key)
    expect(questionKey('So, can you tell me about React?!')).toBe(key)
    expect(questionKey('Okay, um, can you tell me about   React ?')).toBe(key)
  })

  it('keeps different questions apart', () => {
    expect(questionKey('Can you tell me about React?')).not.toBe(
      questionKey('Can you tell me about Vue?')
    )
  })

  it('treats ё and е alike in Russian', () => {
    expect(questionKey('Что вы ещё умеете?')).toBe(questionKey('Что вы еще умеете'))
  })
})

describe('lastSystemFinal', () => {
  it('is the latest from the other side, even after you spoke', () => {
    const finals = [seg('a', 'first'), seg('b', 'What is it?'), seg('c', 'my answer', 'mic')]
    expect(lastSystemFinal(finals)?.id).toBe('b')
  })

  it('skips empty text', () => {
    expect(lastSystemFinal([seg('a', 'real'), seg('b', '   ')])?.id).toBe('a')
  })

  it('is undefined when the other side has not spoken', () => {
    expect(lastSystemFinal([])).toBeUndefined()
    expect(lastSystemFinal([seg('a', 'only me', 'mic')])).toBeUndefined()
  })
})

describe('systemSpeechSince', () => {
  const finals = [
    seg('a', 'Thanks for joining.'),
    seg('b', 'My answer', 'mic'),
    seg('c', ' What would you do '),
    seg('d', 'if the deploy failed?')
  ]

  it('is everything the other side said, in order, without your words', () => {
    expect(systemSpeechSince(finals, null)).toEqual({
      text: 'Thanks for joining. What would you do if the deploy failed?',
      lastId: 'd'
    })
  })

  it('starts after the segment already judged', () => {
    expect(systemSpeechSince(finals, 'a')).toEqual({
      text: 'What would you do if the deploy failed?',
      lastId: 'd'
    })
  })

  it('reads a question the recognizer split across segments as one', () => {
    const joined = systemSpeechSince(finals, 'a')!.text
    expect(findQuestion(joined)).toBe('What would you do if the deploy failed?')
  })

  it('is null when they have said nothing since', () => {
    expect(systemSpeechSince(finals, 'd')).toBeNull()
    expect(systemSpeechSince(finals.slice(0, 2), 'a')).toBeNull()
    expect(systemSpeechSince([], null)).toBeNull()
  })

  it('takes it all when the judged segment is gone', () => {
    expect(systemSpeechSince(finals, 'trimmed-away')?.lastId).toBe('d')
  })
})
