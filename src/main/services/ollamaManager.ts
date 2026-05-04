import { getSettings } from '../settings.js'

const DEFAULT_HOST = 'http://127.0.0.1:11434'

function host(): string {
  return getSettings().ollamaHost?.trim() || DEFAULT_HOST
}

export interface OllamaHealth {
  running: boolean
  host: string
  models: string[]
  error?: string
}

/**
 * Check whether a local Ollama server is reachable. Used by the Privacy Mode
 * toggle in Settings — if Ollama isn't running, we tell the user to install /
 * start it instead of silently failing on first prompt.
 *
 * We don't spawn `ollama serve` ourselves yet — the user installs it once
 * via Homebrew / WinGet / installer.
 */
export async function checkOllama(): Promise<OllamaHealth> {
  const h = host()
  try {
    const res = await fetch(`${h}/api/tags`, {
      signal: AbortSignal.timeout(2500)
    })
    if (!res.ok) return { running: false, host: h, models: [], error: `HTTP ${res.status}` }
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return {
      running: true,
      host: h,
      models: (data.models ?? []).map((m) => m.name)
    }
  } catch (err) {
    return {
      running: false,
      host: h,
      models: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Pull (download) a model into the local Ollama. Returns true on success,
 * false on failure. Does not stream progress — for that, use the IPC channel.
 */
export async function pullModel(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${host()}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, stream: false })
    })
    return res.ok
  } catch {
    return false
  }
}
