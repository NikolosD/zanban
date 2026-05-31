import { createGateway } from '@ai-sdk/gateway'
import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { getSettings } from '../settings.js'
import { sessionManager } from '../transcription/sessionManager.js'
import type { TranscriptSegment } from '../../shared/types.js'
import { buildSystemPrompt, buildUserPrompt, buildVisionSystemPrompt } from './prompts.js'
import { raceTimeout } from './raceTimeout.js'
import { getExchanges, recordExchange } from './exchangeMemory.js'
import { retrieve, type RetrievedSource } from '../rag/index.js'
import type { IWebSearchProvider } from '../providers/types.js'
import { streamWithFallback } from './llm/fallbackChain.js'
import { getPersona } from '../personas/store.js'
import {
  getActiveLlmProvider,
  getActiveVisionProvider,
  getActiveWebSearch,
  getLlmProviderById
} from '../providers/registry.js'
import { recordAiExchange } from '../sync/sessionSync.js'
import { modelFor, fastMaxOutputTokens } from './models.js'

const TRANSCRIPT_BUFFER_LIMIT = 1000

const STREAM_IDLE_TIMEOUT_MS = 30_000

/**
 * In-flight requests, keyed by requestId. Lets `stop()` abort a specific
 * stream from a separate IPC call — the AbortController used to be trapped
 * inside the ask() closure, so the only way to end a stream was the idle
 * timeout. `stoppedByUser` distinguishes an explicit Stop (finalize the
 * partial answer cleanly) from a timeout/error abort (surface a message).
 */
interface InFlight {
  abort: AbortController
  stoppedByUser: boolean
}
const inFlight = new Map<string, InFlight>()

/**
 * Abort an in-flight ask() by id. The stream loop sees the aborted signal and
 * finalizes the partial answer via the shared done-path — no error toast.
 * No-op if the request already finished or never existed.
 */
export function stop(requestId: string): void {
  const entry = inFlight.get(requestId)
  if (!entry) return
  entry.stoppedByUser = true
  entry.abort.abort()
}

function armStreamTimeout(abort: AbortController): { reset: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | null = null
  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!abort.signal.aborted) abort.abort()
    }, STREAM_IDLE_TIMEOUT_MS)
  }
  arm()
  return {
    reset: arm,
    clear: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

class TranscriptBuffer {
  private segments: TranscriptSegment[] = []
  private currentSessionId: string | null = null
  constructor() {
    sessionManager.onSegment((seg) => {
      // Discard buffered transcripts whenever the running session changes —
      // otherwise the prompt we send to the model can contain segments from a
      // previous call, which makes the assistant act like the conversation
      // continues across sessions.
      const state = sessionManager.getState()
      if (state.kind === 'running' && state.sessionId !== this.currentSessionId) {
        this.currentSessionId = state.sessionId
        this.segments = []
      }
      this.segments.push(seg)
      if (this.segments.length > TRANSCRIPT_BUFFER_LIMIT) {
        this.segments = this.segments.slice(-TRANSCRIPT_BUFFER_LIMIT)
      }
    })
  }
  recent(): TranscriptSegment[] {
    return this.segments
  }
}

const transcriptBuffer = new TranscriptBuffer()

export interface AskOptions {
  prompt: string
  contextSeconds?: number
  imageDataUrl?: string
  ocrText?: string
  modelOverride?: string
}

let windows: BrowserWindow[] = []

export function registerAiWindow(win: BrowserWindow): void {
  windows.push(win)
  win.on('closed', () => {
    windows = windows.filter((w) => w !== win)
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function gateway() {
  const settings = getSettings()
  if (!settings.vercelApiKey) {
    throw new Error('Vercel AI Gateway key not configured. Open Settings.')
  }
  return createGateway({ apiKey: settings.vercelApiKey })
}

export async function ask(opts: AskOptions): Promise<{ requestId: string }> {
  const settings = getSettings()
  // Don't reject early on a missing Vercel key — the user may have switched
  // to Anthropic / OpenAI / Gemini / Groq / Ollama in Settings. We re-check
  // only when we actually need to fall back to the gateway path below.
  const requestId = randomUUID()
  const abort = new AbortController()
  const entry: InFlight = { abort, stoppedByUser: false }
  inFlight.set(requestId, entry)
  ;(async () => {
    try {
      const gw = gateway()
      // Optional web search via Tavily. Triggered only when the user has
      // both autoWebSearch enabled AND a Tavily key, AND the prompt looks
      // factual (≥4 words). Failures swallowed — the prompt still goes out.
      let webSearchBlock = ''
      const webProvider = settings.autoWebSearch ? getActiveWebSearch() : null
      if (webProvider && opts.prompt.trim().split(/\s+/).length >= 4) {
        type SearchHit = Awaited<ReturnType<IWebSearchProvider['search']>>[number]
        const hits = await raceTimeout(
          webProvider.search(opts.prompt, { topK: 3 }),
          800,
          [] as SearchHit[]
        )
        if (hits.length > 0) {
          const lines = hits.map((h) => `[${h.title}](${h.url})\n${h.snippet}`).join('\n\n')
          webSearchBlock = `\n\n<web_search>\nLive results from a web search performed just now. Cite URLs when you use a fact from here.\n\n${lines}\n</web_search>`
        }
      }

      // Active persona (if any) wins over the legacy free-form
      // settings.assistantPersona — the prompt builder still receives a
      // single string, so callers don't need to know which one came in.
      const activePersona = settings.activePersonaId ? getPersona(settings.activePersonaId) : null
      const personaText = activePersona?.systemPrompt ?? settings.assistantPersona
      // A persona only overrides the answer language when it pins a SPECIFIC
      // language. 'auto' (or unset) must inherit the global setting — otherwise
      // a persona left on 'auto' would silently cancel the user's forced choice.
      const personaLang = activePersona?.responseLanguage
      const responseLanguage =
        personaLang && personaLang !== 'auto' ? personaLang : settings.responseLanguage

      // RAG: per-persona tuning. useRag === false skips retrieval entirely
      // (handy for brainstorm-style personas that benefit from a clean slate).
      // retrieve() now ranks across transcript history, reference documents, and
      // structured recaps — full docs are no longer dumped into the prompt.
      const ragStrategy = activePersona?.ragStrategy
      const retrieval =
        ragStrategy?.useRag === false
          ? { prompt: '', sources: [] as RetrievedSource[] }
          : await retrieve(opts.prompt, {
              topK: ragStrategy?.topK,
              distanceThreshold: ragStrategy?.distanceThreshold
            }).catch(() => ({ prompt: '', sources: [] as RetrievedSource[] }))

      // Surface what was retrieved so the renderer can show a "Sources" list
      // under the answer. Sent before the answer streams; an empty list clears
      // any stale sources from a previous turn.
      broadcast(IPC.ai.sources, { requestId, sources: retrieval.sources })

      const userPrompt = buildUserPrompt({
        userPrompt: opts.prompt,
        meetingContext: settings.meetingContext,
        segments: transcriptBuffer.recent(),
        contextSeconds: opts.contextSeconds ?? settings.contextSeconds,
        exchanges: getExchanges(),
        ocrText: opts.ocrText,
        retrievedHistory: retrieval.prompt + webSearchBlock,
        responseLanguage
      })

      const hasImage = !!opts.imageDataUrl
      const modelId = hasImage ? modelFor('vision') : modelFor('fast')
      // Text answers honor the "Detailed answers" toggle; vision answers keep
      // their own wider 8k ceiling (code-heavy diagnoses need the room).
      const maxOutputTokens = fastMaxOutputTokens(settings.detailedAnswers)

      // Resolution order: per-request modelOverride > persona.defaultModel >
      // settings/role default. The override layer lets the user pick a model
      // for one Ask without having to reconfigure their persona.
      const personaModel = activePersona?.defaultModel?.trim()
      const overrideModel = opts.modelOverride?.trim() || personaModel || modelId
      // Pick the provider that should actually answer this request. For
      // image-bearing prompts we honor the user's vision-provider override —
      // they may want fast/cheap text via Vercel but a stronger vision model
      // from a different vendor (or vice versa). When the override resolves to
      // 'vercel-gateway' the registry returns null, which routes us into the
      // gateway path below — same outcome as picking Vercel for text.
      const altProvider =
        hasImage && settings.visionProvider ? getActiveVisionProvider() : getActiveLlmProvider()
      // If the user explicitly picked a non-Vercel vision provider but its
      // key is missing, surface a clear error rather than silently falling
      // through to Vercel and confusing the user about why their override
      // was ignored.
      if (
        hasImage &&
        settings.visionProvider &&
        settings.visionProvider !== 'vercel-gateway' &&
        !altProvider
      ) {
        broadcast(IPC.ai.error, {
          requestId,
          message: `Vision provider "${settings.visionProvider}" is missing its API key. Open Settings → AI Provider.`
        })
        return
      }
      // Same guard for the main LLM pick: user chose e.g. Gemini in Settings
      // but never entered the key. Without this check we'd silently route the
      // request to Vercel Gateway with a Gemini model id, which surfaces as a
      // confusing 403 from Vercel instead of an actionable "set your key" hint.
      const useVisionRouting = hasImage && !!settings.visionProvider
      const requestedProvider = useVisionRouting ? settings.visionProvider : settings.llmProvider
      if (!altProvider && requestedProvider && requestedProvider !== 'vercel-gateway') {
        broadcast(IPC.ai.error, {
          requestId,
          message: `LLM provider "${requestedProvider}" is missing its API key. Open Settings → AI Provider.`
        })
        return
      }
      if (altProvider) {
        // Build the providers we'll try in order: the active provider first,
        // then any user-configured fallback ids. Fallbacks whose keys aren't
        // present (resolveProvider returns null) are dropped. We also dedupe
        // so the active provider isn't tried twice if it appears in the
        // fallback list.
        const seenIds = new Set<string>([altProvider.id])
        const providers = [altProvider]
        for (const id of settings.llmFallbackOrder ?? []) {
          if (seenIds.has(id)) continue
          const p = getLlmProviderById(id)
          if (!p) continue
          seenIds.add(id)
          providers.push(p)
        }

        const timeout = armStreamTimeout(abort)
        // Hoisted so the catch can finalize the partial answer on a Stop.
        let fullAnswer = ''
        try {
          let chosenProviderId: string = altProvider.id
          const stream = streamWithFallback(providers, {
            model: overrideModel,
            system: hasImage
              ? buildVisionSystemPrompt(personaText, responseLanguage, settings.uiLocale)
              : buildSystemPrompt(personaText, responseLanguage),
            prompt: userPrompt,
            temperature: hasImage ? 0.3 : 0.4,
            maxOutputTokens: maxOutputTokens,
            imageDataUrl: opts.imageDataUrl,
            signal: abort.signal
          })
          // Drive the generator by hand so we can read its *return* value (the
          // normalized finish reason) — `for await` would discard it.
          let next = await stream.next()
          while (!next.done) {
            const ev = next.value
            // User-initiated Stop: finalize the partial answer cleanly via the
            // shared done-path below. A timeout abort (stoppedByUser === false)
            // still bails to the catch so it surfaces as an error.
            if (abort.signal.aborted) {
              if (entry.stoppedByUser) break
              return
            }
            timeout.reset()
            if (ev.kind === 'fallback') {
              chosenProviderId = ev.toProviderId
              console.warn(
                `[ai] provider ${ev.fromProviderId} failed before emitting; falling back to ${ev.toProviderId}: ${ev.reason}`
              )
            } else {
              fullAnswer += ev.text
              broadcast(IPC.ai.chunk, { requestId, text: ev.text })
            }
            next = await stream.next()
          }
          // The generator's done-value holds the finish reason; on a user Stop
          // we broke early, so flag it as a clean 'stop'.
          const finishReason = entry.stoppedByUser ? 'stop' : next.done ? next.value : undefined
          timeout.clear()
          recordExchange(opts.prompt, fullAnswer)
          void recordAiExchange(opts.prompt, fullAnswer, overrideModel).catch(() => {})
          broadcast(IPC.ai.done, { requestId, finishReason })
          // Best-effort: log which provider actually answered, useful when
          // the fallback chain kicks in and the user's primary was unhealthy.
          if (chosenProviderId !== altProvider.id) {
            console.info(`[ai] answered via fallback provider: ${chosenProviderId}`)
          }
          return
        } catch (err) {
          // Provider failure: surface it to the user instead of silently
          // falling back to Vercel Gateway. Falling through used to happen
          // here, but it caused two bugs:
          //   1. Errors got hidden behind a misleading 403 from Vercel.
          //   2. Vercel routing parsed a non-namespaced model ID
          //      (e.g. "claude-haiku-4-5" without "anthropic/") and rejected.
          // If the user picked a non-default provider, we honor that pick.
          // An explicit Stop can surface as an AbortError from the SDK — treat
          // it as a clean finalize, not a failure.
          if (entry.stoppedByUser) {
            recordExchange(opts.prompt, fullAnswer)
            void recordAiExchange(opts.prompt, fullAnswer, overrideModel).catch(() => {})
            broadcast(IPC.ai.done, { requestId, finishReason: 'stop' })
            return
          }
          const aborted = abort.signal.aborted
          const message = aborted
            ? 'LLM stream timed out (no response for 30s)'
            : err instanceof Error
              ? err.message
              : 'unknown provider error'
          console.error('[ai] alt provider failed', err)
          broadcast(IPC.ai.error, { requestId, message })
          return
        } finally {
          timeout.clear()
        }
      }

      // Reached the legacy Vercel-Gateway path: now we need the key, but only
      // now. Surface a clear error to the user instead of crashing inside the
      // SDK initializer.
      if (!settings.vercelApiKey) {
        throw new Error(
          'No LLM provider configured. Set a provider key in Settings (Anthropic, OpenAI, Gemini, Groq, Ollama, or Vercel AI Gateway).'
        )
      }

      const streamArgs = hasImage
        ? {
            model: gw(overrideModel),
            // Vision answers (code solutions, error diagnoses) need more room
            // than the brevity-capped text answers — coding-kata solutions
            // alone routinely run 200-400 tokens.
            system: buildVisionSystemPrompt(personaText, responseLanguage, settings.uiLocale),
            messages: [
              {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, text: userPrompt },
                  { type: 'image' as const, image: opts.imageDataUrl as string }
                ]
              }
            ],
            abortSignal: abort.signal,
            // Vision answers can be code-heavy: a kata solution + explanation +
            // edge cases easily runs past 1.5k tokens, after which the stream
            // truncates mid-line. 8k is a safe ceiling — Gemini 2.5 Flash
            // bills only on what it actually emits, so this isn't wasteful.
            maxOutputTokens: 8000,
            temperature: 0.3
          }
        : {
            model: gw(overrideModel),
            system: buildSystemPrompt(personaText, responseLanguage),
            prompt: userPrompt,
            abortSignal: abort.signal,
            maxOutputTokens: maxOutputTokens,
            temperature: 0.4
          }

      const result = streamText(streamArgs)
      const gwTimeout = armStreamTimeout(abort)

      let fullAnswer = ''
      let stoppedEarly = false
      try {
        for await (const text of result.textStream) {
          // User-initiated Stop finalizes the partial answer below; a timeout
          // abort still bails to the catch as an error.
          if (abort.signal.aborted) {
            if (entry.stoppedByUser) {
              stoppedEarly = true
              break
            }
            return
          }
          gwTimeout.reset()
          if (text) {
            fullAnswer += text
            broadcast(IPC.ai.chunk, { requestId, text })
          }
        }
      } finally {
        gwTimeout.clear()
      }
      // `finishReason` is resolved once the stream completes. We surface it
      // so the UI can flag length-truncations (the model hit maxOutputTokens
      // and stopped mid-thought) — that was the failure mode the user hit
      // when a vision answer cut off in the middle of a code block. On an
      // explicit Stop we broke early, so flag it as a clean 'stop'.
      const finishReason = stoppedEarly
        ? 'stop'
        : await Promise.resolve(result.finishReason).catch(() => undefined)
      recordExchange(opts.prompt, fullAnswer)
      void recordAiExchange(opts.prompt, fullAnswer, overrideModel).catch(() => {})
      broadcast(IPC.ai.done, { requestId, finishReason })
    } catch (err) {
      // An explicit Stop can throw an AbortError from the SDK — finalize
      // cleanly rather than showing an error toast.
      if (entry.stoppedByUser) {
        broadcast(IPC.ai.done, { requestId, finishReason: 'stop' })
      } else {
        const message = err instanceof Error ? err.message : 'unknown error'
        broadcast(IPC.ai.error, { requestId, message })
      }
    } finally {
      inFlight.delete(requestId)
    }
  })()

  return { requestId }
}
