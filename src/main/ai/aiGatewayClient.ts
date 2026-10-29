import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import {
  ANSWER_LAST_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  SHORTEN_PROMPT,
  WHAT_TO_ANSWER_PROMPT
} from '../../shared/prompts.js'
import { getSettings } from '../settings.js'
import { sessionManager } from '../transcription/sessionManager.js'
import type { TranscriptSegment } from '../../shared/types.js'
import { buildSystemPrompt, buildUserPrompt, buildVisionSystemPrompt } from './prompts.js'
import { raceTimeout } from './raceTimeout.js'
import { getExchanges, recordExchange } from './exchangeMemory.js'
import { retrieve, type RetrievalResult } from '../rag/index.js'
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
import {
  availableGatewayModel,
  fastMaxOutputTokens,
  gatewayCallOptions,
  modelFor
} from './models.js'

const TRANSCRIPT_BUFFER_LIMIT = 1000

const STREAM_IDLE_TIMEOUT_MS = 30_000
const STREAM_TIMEOUT_MESSAGE = 'LLM stream timed out (no response for 30s)'

const RETRIEVAL_TIMEOUT_MS = 1500
const RETRIEVAL_QUERY_MAX_WORDS = 60

// Vision answers can be code-heavy: a kata solution + explanation + edge cases
// easily runs past 1.5k tokens, after which the stream truncates mid-line.
// Providers bill only on what is emitted, so the high ceiling isn't wasteful.
const VISION_MAX_OUTPUT_TOKENS = 8000

const GATEWAY_NAME = 'Vercel AI Gateway'

const FIXED_PROMPTS = new Set([
  ANSWER_LAST_PROMPT,
  SCREENSHOT_DEFAULT_PROMPT,
  FOLLOW_UP_PROMPT,
  RECAP_PROMPT,
  WHAT_TO_ANSWER_PROMPT,
  SHORTEN_PROMPT
])

type SearchHit = Awaited<ReturnType<IWebSearchProvider['search']>>[number]

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
    // Discard buffered transcripts as soon as a session starts — otherwise the
    // prompt we send to the model can contain segments from a previous call
    // (an ask in the first seconds of a call, before anyone has spoken), which
    // makes the assistant act like the conversation continues across sessions.
    sessionManager.onState((state) => {
      if (state.kind !== 'running') return
      this.currentSessionId = state.sessionId
      this.segments = []
    })
    sessionManager.onSegment((seg, sessionId) => {
      // A straggler from the previous call landing after this one started.
      if (sessionId !== this.currentSessionId) return
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
  requestId: string
  prompt: string
  contextSeconds?: number
  imageDataUrl?: string
  ocrText?: string
  modelOverride?: string
}

let windows: BrowserWindow[] = []
// Answer text streamed while a window was hidden, per window and request. The
// renderer builds an answer by appending its chunks, so a hidden window gets
// what it missed as one chunk when it is shown or before the request ends.
const heldChunks = new Map<BrowserWindow, Map<string, string>>()

export function registerAiWindow(win: BrowserWindow): void {
  windows.push(win)
  const flush = (): void => flushHeldChunks(win)
  win.on('show', flush)
  win.on('restore', flush)
  win.on('closed', () => {
    windows = windows.filter((w) => w !== win)
    heldChunks.delete(win)
  })
}

function flushHeldChunks(win: BrowserWindow, onlyRequestId?: string): void {
  const held = heldChunks.get(win)
  if (!held) return
  for (const [requestId, text] of held) {
    if (onlyRequestId !== undefined && requestId !== onlyRequestId) continue
    win.webContents.send(IPC.ai.chunk, { requestId, text })
    held.delete(requestId)
  }
  if (held.size === 0) heldChunks.delete(win)
}

function broadcast<P extends { requestId: string }>(channel: string, payload: P): void {
  for (const w of windows) {
    if (w.isDestroyed()) continue
    flushHeldChunks(w, payload.requestId)
    w.webContents.send(channel, payload)
  }
}

// Once per model per run: the notice is for the user to pick another model,
// not something to repeat on every answer.
const replacedNotified = new Set<string>()

function notifyModelReplaced(from: string, to: string): void {
  console.warn(`[ai] gateway model ${from} is gone from the catalog; answering with ${to}`)
  if (replacedNotified.has(from)) return
  replacedNotified.add(from)
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(IPC.ai.modelReplaced, { from, to })
  }
}

function broadcastChunk(requestId: string, text: string): void {
  for (const w of windows) {
    if (w.isDestroyed()) continue
    if (w.isVisible() && !w.isMinimized()) {
      flushHeldChunks(w, requestId)
      w.webContents.send(IPC.ai.chunk, { requestId, text })
      continue
    }
    const held = heldChunks.get(w) ?? new Map<string, string>()
    held.set(requestId, (held.get(requestId) ?? '') + text)
    heldChunks.set(w, held)
  }
}

async function gateway() {
  const settings = getSettings()
  if (!settings.vercelApiKey) {
    throw new Error('Vercel AI Gateway key not configured. Open Settings.')
  }
  const { createGateway } = await import('@ai-sdk/gateway')
  return createGateway({ apiKey: settings.vercelApiKey })
}

/**
 * Query for RAG + web search. Hotkeys and chips send fixed instruction prompts
 * ("Answer the last question…"), and searching for that text matches nothing
 * useful — so for those, search for what was just said, preferring the other
 * speaker's channel.
 */
export function retrievalQueryFor(prompt: string, segments: TranscriptSegment[]): string {
  if (!FIXED_PROMPTS.has(prompt.trim())) return prompt
  const finals = segments.filter((s) => s.isFinal && s.text.trim())
  const theirs = finals.filter((s) => s.channel === 'system')
  const pool = theirs.length > 0 ? theirs : finals
  const words: string[] = []
  for (let i = pool.length - 1; i >= 0 && words.length < RETRIEVAL_QUERY_MAX_WORDS; i--) {
    words.unshift(...pool[i]!.text.trim().split(/\s+/))
  }
  return words.slice(-RETRIEVAL_QUERY_MAX_WORDS).join(' ')
}

/**
 * User-facing text for a provider failure. SDKs put the raw HTTP body in the
 * message (e.g. `401 {"type":"error","error":{…}}`), which is noise in a toast.
 */
export function describeProviderError(err: unknown, providerName: string): string {
  const raw = rawErrorMessage(err)
  const status = errorStatus(err, raw)
  if (status === 401 || status === 403) {
    return `${providerName} rejected the API key (${status}). Check it in Settings → AI.`
  }
  const detail = jsonErrorDetail(raw)
  if (!detail) return raw
  return status ? `${providerName}: ${detail} (${status})` : `${providerName}: ${detail}`
}

function rawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? 'unknown provider error'
  } catch {
    return 'unknown provider error'
  }
}

function errorStatus(err: unknown, message: string): number | undefined {
  if (err && typeof err === 'object') {
    const { status, statusCode } = err as { status?: unknown; statusCode?: unknown }
    if (typeof status === 'number') return status
    if (typeof statusCode === 'number') return statusCode
  }
  const m = message.match(/^(\d{3})\b/)
  return m ? Number(m[1]) : undefined
}

function jsonErrorDetail(message: string): string | null {
  const start = message.indexOf('{')
  if (start < 0) return null
  let body: { message?: unknown; error?: unknown }
  try {
    body = JSON.parse(message.slice(start)) as typeof body
  } catch {
    return null
  }
  if (typeof body.error === 'string') return body.error
  const inner = body.error as { message?: unknown } | null | undefined
  if (typeof inner?.message === 'string') return inner.message
  return typeof body.message === 'string' ? body.message : null
}

export async function ask(opts: AskOptions): Promise<{ requestId: string }> {
  const settings = getSettings()
  // Don't reject early on a missing Vercel key — the user may have switched
  // to Anthropic / OpenAI / Gemini / Groq / Ollama in Settings. We re-check
  // only when we actually need to fall back to the gateway path below.
  const { requestId } = opts
  const abort = new AbortController()
  const entry: InFlight = { abort, stoppedByUser: false }
  inFlight.set(requestId, entry)
  ;(async () => {
    try {
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
      // It runs concurrently with web search, each bounded so optional
      // augmentation never holds up the answer (the embedder can take seconds
      // to load on first use).
      const searchQuery = retrievalQueryFor(opts.prompt, transcriptBuffer.recent())
      const ragStrategy = activePersona?.ragStrategy
      const liveCall = sessionManager.getState()
      const noRetrieval: RetrievalResult = { prompt: '', sources: [] }
      const retrievalTask =
        ragStrategy?.useRag === false || !searchQuery.trim()
          ? Promise.resolve(noRetrieval)
          : raceTimeout(
              retrieve(searchQuery, {
                topK: ragStrategy?.topK,
                distanceThreshold: ragStrategy?.distanceThreshold,
                // This call's recent chunks duplicate the transcript window below.
                currentSessionId: liveCall.kind === 'running' ? liveCall.sessionId : undefined,
                transcriptWindowStart:
                  Date.now() - (opts.contextSeconds ?? settings.contextSeconds) * 1000
              }).catch((err: unknown) => {
                console.warn('[ai] retrieval failed', err)
                return noRetrieval
              }),
              RETRIEVAL_TIMEOUT_MS,
              noRetrieval
            )

      // Optional web search via Tavily. Triggered only when the user has
      // both autoWebSearch enabled AND a Tavily key, AND the query looks
      // factual (≥4 words). Failures swallowed — the prompt still goes out.
      const webProvider = settings.autoWebSearch ? getActiveWebSearch() : null
      const webSearchTask =
        webProvider && searchQuery.trim().split(/\s+/).length >= 4
          ? raceTimeout(webProvider.search(searchQuery, { topK: 3 }), 800, [] as SearchHit[])
          : Promise.resolve([] as SearchHit[])

      const [retrieval, hits] = await Promise.all([retrievalTask, webSearchTask])
      let webSearchBlock = ''
      if (hits.length > 0) {
        const lines = hits
          .map((h) => `[${h.title}](${h.url})\n${h.snippet}`)
          .join('\n\n')
          .replace(/<\s*\/\s*web_search\s*>/gi, '&lt;/web_search&gt;')
        webSearchBlock = `\n\n<web_search>\nLive results from a web search performed just now. Cite URLs when you use a fact from here.\n\n${lines}\n</web_search>`
      }

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
      const maxOutputTokens = hasImage
        ? VISION_MAX_OUTPUT_TOKENS
        : fastMaxOutputTokens(settings.detailedAnswers)

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
        // Hoisted so the catch can finalize the partial answer on a Stop and
        // name the provider that actually failed.
        let fullAnswer = ''
        let chosenProviderId: string = altProvider.id
        try {
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
              throw new Error('LLM stream timed out')
            }
            timeout.reset()
            if (ev.kind === 'fallback') {
              chosenProviderId = ev.toProviderId
              console.warn(
                `[ai] provider ${ev.fromProviderId} failed before emitting; falling back to ${ev.toProviderId}: ${ev.reason}`
              )
            } else {
              fullAnswer += ev.text
              broadcastChunk(requestId, ev.text)
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
          const failed = providers.find((p) => p.id === chosenProviderId) ?? altProvider
          const message = abort.signal.aborted
            ? STREAM_TIMEOUT_MESSAGE
            : describeProviderError(err, failed.label)
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
      const gw = await gateway()
      const gatewayModel = availableGatewayModel(overrideModel, hasImage ? 'vision' : 'fast')
      if (gatewayModel !== overrideModel) notifyModelReplaced(overrideModel, gatewayModel)
      const { streamText } = await import('ai')

      const streamArgs = hasImage
        ? {
            model: gw(gatewayModel),
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
            maxOutputTokens: maxOutputTokens,
            ...gatewayCallOptions(gatewayModel, 0.3)
          }
        : {
            model: gw(gatewayModel),
            system: buildSystemPrompt(personaText, responseLanguage),
            prompt: userPrompt,
            abortSignal: abort.signal,
            maxOutputTokens: maxOutputTokens,
            ...gatewayCallOptions(gatewayModel, 0.4)
          }

      const result = streamText(streamArgs)
      const gwTimeout = armStreamTimeout(abort)

      // fullStream rather than textStream: textStream silently drops error
      // parts, and an abort just closes it, so a bad key or the idle timeout
      // used to end as an empty answer with a normal `done`.
      let fullAnswer = ''
      let finishReason: string | undefined
      try {
        for await (const part of result.fullStream) {
          if (abort.signal.aborted) break
          gwTimeout.reset()
          if (part.type === 'text-delta') {
            if (part.text) {
              fullAnswer += part.text
              broadcastChunk(requestId, part.text)
            }
          } else if (part.type === 'error') {
            throw part.error instanceof Error
              ? part.error
              : new Error(describeProviderError(part.error, GATEWAY_NAME))
          } else if (part.type === 'finish') {
            finishReason = part.finishReason
          }
        }
      } finally {
        gwTimeout.clear()
      }
      if (!entry.stoppedByUser) {
        if (abort.signal.aborted) throw new Error(STREAM_TIMEOUT_MESSAGE)
        if (!fullAnswer.trim()) {
          throw new Error(
            `The model returned an empty answer (finish reason: ${finishReason ?? 'unknown'}). Try again or pick another model.`
          )
        }
      }
      recordExchange(opts.prompt, fullAnswer)
      void recordAiExchange(opts.prompt, fullAnswer, gatewayModel).catch(() => {})
      // finishReason lets the UI flag length-truncations (the model hit
      // maxOutputTokens and stopped mid-thought).
      broadcast(IPC.ai.done, {
        requestId,
        finishReason: entry.stoppedByUser ? 'stop' : finishReason
      })
    } catch (err) {
      // An explicit Stop can throw an AbortError from the SDK — finalize
      // cleanly rather than showing an error toast.
      if (entry.stoppedByUser) {
        broadcast(IPC.ai.done, { requestId, finishReason: 'stop' })
      } else {
        const message = abort.signal.aborted
          ? STREAM_TIMEOUT_MESSAGE
          : describeProviderError(err, GATEWAY_NAME)
        broadcast(IPC.ai.error, { requestId, message })
      }
    } finally {
      inFlight.delete(requestId)
    }
  })()

  return { requestId }
}
