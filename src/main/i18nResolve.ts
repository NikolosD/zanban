export type Locale = 'en' | 'ru'

/**
 * Pure key resolver — no electron, no settings dependency, no JSON imports.
 * Resolves a dotted i18n key (e.g. `tray.start_session`) against the given
 * resources for `locale` with simple `{{var}}` interpolation. Falls back to
 * English, then to the raw key, so a missing translation degrades gracefully
 * instead of throwing.
 *
 * Kept in its own module (separate from `i18n.ts`, which pulls in settings →
 * electron) so it can be unit-tested in the plain node environment.
 */
export function resolveTranslation(
  resources: Record<Locale, unknown>,
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const resolved = lookup(resources[locale], key) ?? lookup(resources.en, key)
  if (typeof resolved !== 'string') return key
  return interpolate(resolved, vars)
}

function lookup(resource: unknown, key: string): unknown {
  let node: unknown = resource
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return node
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  )
}
