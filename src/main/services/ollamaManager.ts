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

interface PullEvent {
  status?: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/**
 * Pull (download) a model into the local Ollama. Returns true on success,
 * false on failure. Reports the bytes downloaded so far, summed over the
 * model's layers, each time the whole percent changes.
 */
export async function pullModel(
  name: string,
  onProgress: (completed: number, total: number) => void
): Promise<boolean> {
  try {
    const res = await fetch(`${host()}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name })
    })
    if (!res.ok || !res.body) return false
    const layers = new Map<string, { completed: number; total: number }>()
    const decoder = new TextDecoder()
    let pending = ''
    let reported = -1
    let succeeded = false
    // One JSON object per line; a line can be split across chunks.
    for await (const chunk of res.body) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as PullEvent
        if (event.error) {
          console.warn(`[ollama] pull ${name} failed: ${event.error}`)
          return false
        }
        if (event.status === 'success') succeeded = true
        if (!event.digest || !event.total) continue
        layers.set(event.digest, { completed: event.completed ?? 0, total: event.total })
        let completed = 0
        let total = 0
        for (const layer of layers.values()) {
          completed += layer.completed
          total += layer.total
        }
        const percent = Math.floor((completed / total) * 100)
        if (percent === reported) continue
        reported = percent
        onProgress(completed, total)
      }
    }
    return succeeded
  } catch (err) {
    console.warn(`[ollama] pull ${name} failed`, err)
    return false
  }
}
