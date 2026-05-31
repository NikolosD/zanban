import en from '../shared/locales/en.json'
import ru from '../shared/locales/ru.json'
import { getSettings } from './settings.js'
import { resolveTranslation, type Locale } from './i18nResolve.js'

const RESOURCES: Record<Locale, unknown> = { en, ru }

/**
 * Resolve a key for the user's current UI locale (read from settings). The
 * main process has no react-i18next, so the tray menu and native toasts use
 * the tiny resolver in {@link resolveTranslation} over the SAME JSON the
 * renderer uses — keys stay in one place.
 */
export function translate(
  key: string,
  vars?: Record<string, string | number>,
  locale?: Locale
): string {
  const lng = locale ?? (getSettings().uiLocale === 'ru' ? 'ru' : 'en')
  return resolveTranslation(RESOURCES, lng, key, vars)
}
