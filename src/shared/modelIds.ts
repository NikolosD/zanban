/**
 * Whether a provider's model list serves `model`: listed as is, or as a dated
 * snapshot (claude-haiku-4-5-20251001) that the plain id is an alias for.
 */
export function servesModel(ids: readonly string[], model: string): boolean {
  return ids.some((id) => id === model || id.startsWith(`${model}-`))
}
