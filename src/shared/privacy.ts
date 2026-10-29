import type { AppSettings } from './types.js'

/**
 * Privacy mode is this state rather than a stored flag: answers from Ollama
 * and speech recognition on this computer. Picking a cloud provider for
 * either one ends it, so the switch never claims a setup that sends data out.
 */
export function isPrivateSetup(
  settings: Pick<AppSettings, 'llmProvider' | 'sttProvider'>
): boolean {
  return settings.llmProvider === 'ollama' && settings.sttProvider === 'local-whisper'
}
