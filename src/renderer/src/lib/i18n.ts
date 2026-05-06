import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'

export type UiLocale = 'en' | 'ru'

/**
 * One-shot initialization for the renderer's i18next instance. Each window
 * (dashboard, overlay, chat, cropper) calls this once before rendering. The
 * locale is read synchronously from the preload-exposed settings — that way
 * the first paint already shows the right language instead of flashing
 * English and switching.
 */
export function initI18n(initialLocale: UiLocale = 'en'): typeof i18n {
  if (i18n.isInitialized) {
    if (i18n.language !== initialLocale) {
      void i18n.changeLanguage(initialLocale)
    }
    return i18n
  }
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ru: { translation: ru }
    },
    lng: initialLocale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false
  })
  return i18n
}

/**
 * Subscribe to live settings changes from main and flip the language when
 * the user picks a different one in Settings → General. Returns an
 * unsubscribe — call it from the same scope as `initI18n`.
 */
export function wireLocaleSync(): () => void {
  return window.zanban.settings.onChanged((next) => {
    const target = (next.uiLocale ?? 'en') as UiLocale
    if (i18n.language !== target) {
      void i18n.changeLanguage(target)
    }
  })
}
