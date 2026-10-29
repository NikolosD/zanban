import type { AppSettings, LlmProvider } from '../../shared/types.js'
import { isPrivateSetup } from '../../shared/privacy.js'

type RoutingSettings = Pick<
  AppSettings,
  | 'llmProvider'
  | 'sttProvider'
  | 'visionProvider'
  | 'llmFallbackOrder'
  | 'privacyCloudFallback'
  | 'autoWebSearch'
>

// Ollama is the one provider that runs on this computer.
const LOCAL_PROVIDERS: ReadonlySet<LlmProvider> = new Set(['ollama'])

/**
 * The provider that answers: the vision override for a screenshot, otherwise
 * the main one. In privacy mode a cloud vision override is ignored, so a
 * screenshot stays on this computer like everything else.
 */
export function answerProviderId(settings: RoutingSettings, hasImage: boolean): LlmProvider {
  const vision = hasImage ? settings.visionProvider : null
  if (!vision) return settings.llmProvider
  if (isPrivateSetup(settings) && !LOCAL_PROVIDERS.has(vision)) return settings.llmProvider
  return vision
}

/**
 * Backups to try after `primary`, in the user's order. In privacy mode only
 * local ones, unless the user allowed cloud backups there.
 */
export function backupProviderIds(settings: RoutingSettings, primary: LlmProvider): LlmProvider[] {
  const cloudAllowed = !isPrivateSetup(settings) || settings.privacyCloudFallback
  return [...new Set(settings.llmFallbackOrder)].filter(
    (id) => id !== primary && (cloudAllowed || LOCAL_PROVIDERS.has(id))
  )
}

/** Web search sends the question to Tavily, so privacy mode skips it. */
export function webSearchAllowed(settings: RoutingSettings): boolean {
  return settings.autoWebSearch && !isPrivateSetup(settings)
}
