import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'
import ru from '@shared/locales/ru.json'
import type { AiError } from '@shared/types'
import { useAi, wireAiIpc } from './store'

void i18n.init({
  lng: 'ru',
  resources: { ru: { translation: ru } },
  interpolation: { escapeValue: false }
})

function wireWithError() {
  let emit: (err: AiError) => void = () => {}
  const off = () => {}
  vi.stubGlobal('window', {
    zanban: {
      ai: {
        onChunk: () => off,
        onSources: () => off,
        onDone: () => off,
        onError: (cb: (err: AiError) => void) => {
          emit = cb
          return off
        }
      }
    }
  })
  wireAiIpc()
  return (err: AiError) => emit(err)
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAi.getState().reset()
})

describe('AI errors', () => {
  it('explains a known failure in the interface language', () => {
    const emit = wireWithError()
    useAi.getState().newRequest('q', 'r1')
    emit({
      requestId: 'r1',
      message: "Ollama isn't answering at http://127.0.0.1:11434.",
      reason: { kind: 'ollama_unreachable', host: 'http://127.0.0.1:11434' }
    })
    expect(useAi.getState().messages[0]?.error).toBe(
      'Ollama не отвечает по адресу http://127.0.0.1:11434. Запустите Ollama или проверьте адрес в Настройки → Ключи и провайдеры.'
    )
  })

  it('shows any other error as main wrote it', () => {
    const emit = wireWithError()
    useAi.getState().newRequest('q', 'r2')
    emit({ requestId: 'r2', message: 'Anthropic: Overloaded (529)' })
    expect(useAi.getState().messages[0]?.error).toBe('Anthropic: Overloaded (529)')
  })
})
