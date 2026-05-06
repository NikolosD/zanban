import { createGateway } from '@ai-sdk/gateway'
import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { getSettings } from '../settings.js'
import { sessionManager } from '../transcription/sessionManager.js'
import type { TranscriptSegment } from '../../shared/types.js'
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildVisionSystemPrompt,
  QUESTION_EXTRACTOR_PROMPT
} from './prompts.js'
import { getExchanges, recordExchange } from './exchangeMemory.js'
import { retrieveContext } from '../rag/index.js'
import { generateOneShot } from './llm/baseLlm.js'
import { streamWithFallback } from './llm/fallbackChain.js'
import { getPersona } from '../personas/store.js'
import {
  getActiveLlmProvider,
  getActiveVisionProvider,
  getActiveWebSearch,
  getLlmProviderById
} from '../providers/registry.js'
import { recordAiExchange } from '../sync/sessionSync.js'
import { modelFor, FAST_MAX_OUTPUT_TOKENS } from './models.js'

const TRANSCRIPT_BUFFER_LIMIT = 1000

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

  ;(async () => {
    try {
      const gw = gateway()
      // Optional web search via Tavily. Triggered only when the user has
      // both autoWebSearch enabled AND a Tavily key, AND the prompt looks
      // factual (≥4 words). Failures swallowed — the prompt still goes out.
      let webSearchBlock = ''
      const webProvider = settings.autoWebSearch ? getActiveWebSearch() : null
      if (webProvider && opts.prompt.trim().split(/\s+/).length >= 4) {
        try {
          const hits = await webProvider.search(opts.prompt, { topK: 3 })
          if (hits.length > 0) {
            const lines = hits.map((h) => `[${h.title}](${h.url})\n${h.snippet}`).join('\n\n')
            webSearchBlock = `\n\n<web_search>\nLive results from a web search performed just now. Cite URLs when you use a fact from here.\n\n${lines}\n</web_search>`
          }
        } catch (err) {
          console.warn('[ai] web search failed', err)
        }
      }

      // Active persona (if any) wins over the legacy free-form
      // settings.assistantPersona — the prompt builder still receives a
      // single string, so callers don't need to know which one came in.
      const activePersona = settings.activePersonaId ? getPersona(settings.activePersonaId) : null
      const personaText = activePersona?.systemPrompt ?? settings.assistantPersona
      const responseLanguage = activePersona?.responseLanguage ?? settings.responseLanguage

      // RAG: per-persona tuning. useRag === false skips retrieval entirely
      // (handy for brainstorm-style personas that benefit from a clean slate).
      const ragStrategy = activePersona?.ragStrategy
      const retrievedHistory =
        ragStrategy?.useRag === false
          ? ''
          : await retrieveContext(opts.prompt, {
              topK: ragStrategy?.topK,
              distanceThreshold: ragStrategy?.distanceThreshold
            }).catch(() => '')

      const userPrompt = buildUserPrompt({
        userPrompt: opts.prompt,
        meetingContext: settings.meetingContext,
        segments: transcriptBuffer.recent(),
        contextSeconds: opts.contextSeconds ?? settings.contextSeconds,
        exchanges: getExchanges(),
        ocrText: opts.ocrText,
        retrievedHistory: retrievedHistory + webSearchBlock
      })

      const hasImage = !!opts.imageDataUrl
      const modelId = hasImage ? modelFor('vision') : modelFor('fast')

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

        try {
          let fullAnswer = ''
          let chosenProviderId: string = altProvider.id
          const stream = streamWithFallback(providers, {
            model: overrideModel,
            system: hasImage
              ? buildVisionSystemPrompt(personaText, responseLanguage)
              : buildSystemPrompt(personaText, responseLanguage),
            prompt: userPrompt,
            temperature: hasImage ? 0.3 : 0.4,
            maxOutputTokens: hasImage ? 8000 : FAST_MAX_OUTPUT_TOKENS,
            imageDataUrl: opts.imageDataUrl,
            signal: abort.signal
          })
          for await (const ev of stream) {
            if (abort.signal.aborted) return
            if (ev.kind === 'fallback') {
              chosenProviderId = ev.toProviderId
              console.warn(
                `[ai] provider ${ev.fromProviderId} failed before emitting; falling back to ${ev.toProviderId}: ${ev.reason}`
              )
              continue
            }
            fullAnswer += ev.text
            broadcast(IPC.ai.chunk, { requestId, text: ev.text })
          }
          recordExchange(opts.prompt, fullAnswer)
          void recordAiExchange(opts.prompt, fullAnswer, overrideModel).catch(() => {})
          broadcast(IPC.ai.done, { requestId })
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
          const message = err instanceof Error ? err.message : 'unknown provider error'
          console.error('[ai] alt provider failed', err)
          broadcast(IPC.ai.error, { requestId, message })
          return
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
            system: buildVisionSystemPrompt(personaText, responseLanguage),
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
            maxOutputTokens: FAST_MAX_OUTPUT_TOKENS,
            temperature: 0.4
          }

      const result = streamText(streamArgs)

      let fullAnswer = ''
      for await (const text of result.textStream) {
        if (abort.signal.aborted) return
        if (text) {
          fullAnswer += text
          broadcast(IPC.ai.chunk, { requestId, text })
        }
      }
      // `finishReason` is resolved once the stream completes. We surface it
      // so the UI can flag length-truncations (the model hit maxOutputTokens
      // and stopped mid-thought) — that was the failure mode the user hit
      // when a vision answer cut off in the middle of a code block.
      const finishReason = await Promise.resolve(result.finishReason).catch(() => undefined)
      recordExchange(opts.prompt, fullAnswer)
      void recordAiExchange(opts.prompt, fullAnswer, overrideModel).catch(() => {})
      broadcast(IPC.ai.done, { requestId, finishReason })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      broadcast(IPC.ai.error, { requestId, message })
    }
  })()

  return { requestId }
}

export async function extractQuestion(text: string): Promise<string | null> {
  const trimmed = text.trim().slice(0, 1000)
  if (!trimmed) return null
  try {
    // Routes through whichever LLM provider is active (Anthropic, OpenAI,
    // Gemini, Groq, Ollama, or Vercel Gateway as the fallback). Previously
    // it was hard-wired to Vercel — that meant question detection silently
    // died on users who only had an Anthropic / OpenAI key set.
    const out = await generateOneShot({
      role: 'filter',
      system: QUESTION_EXTRACTOR_PROMPT,
      prompt: trimmed,
      temperature: 0,
      maxOutputTokens: 120
    })
    const cleaned = out.trim()
    if (!cleaned) return null
    if (/^none\b/i.test(cleaned)) return null
    return cleaned.replace(/^["'`]+|["'`]+$/g, '')
  } catch (err) {
    console.warn('[ai] extractQuestion failed', err)
    return null
  }
}
