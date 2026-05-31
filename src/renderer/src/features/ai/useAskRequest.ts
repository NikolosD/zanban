import { useCallback, useRef, useState } from 'react'
import { useAi } from './store'
import { useTranscript } from '@renderer/features/transcript/store'
import { SCREENSHOT_DEFAULT_PROMPT } from '@shared/prompts'

/**
 * Wait briefly for STT to flush the latest partial before we send the prompt.
 * If the transcript was updated within `quietMs` of now, poll until either it
 * has been quiet for `quietMs` OR the cap (`maxWaitMs`) elapses. Returns
 * immediately if the transcript is already settled or no session is running.
 *
 * Extracted verbatim from OverlayApp.awaitTranscriptSettle so the dashboard
 * AskPanel gets the same "don't answer before the question finished arriving"
 * behavior the overlay already had.
 */
async function awaitTranscriptSettle(maxWaitMs = 600, quietMs = 250): Promise<void> {
  const start = Date.now()
  if (useTranscript.getState().session.kind !== 'running') return
  while (Date.now() - start < maxWaitMs) {
    const last = useTranscript.getState().lastUpdateAt
    if (!last || Date.now() - last >= quietMs) return
    await new Promise((r) => setTimeout(r, 120))
  }
}

export interface AskRequestOptions {
  /** Prompt sent to the LLM. Falls back to SCREENSHOT_DEFAULT_PROMPT when empty
   *  but an image is attached. */
  prompt: string
  /** Optional display label for the answer card. Defaults to the prompt. */
  label?: string
  /** Optional base64 data URL of an attached screenshot. */
  image?: string | null
  /** Optional OCR text extracted from the screenshot. */
  ocr?: string | null
  /** When true, wait for the transcript to settle before sending (overlay's
   *  Answer/What-to-answer gestures rely on this). */
  waitForTranscript?: boolean
  /** Override the model for this request only. */
  modelOverride?: string | null
}

export interface UseAskRequest {
  /** Fire a request. Resolves once the ask has been dispatched (not when the
   *  stream completes). No-op while another request is in flight. */
  run(opts: AskRequestOptions): Promise<void>
  /** Abort the in-flight request, if any. Main finalizes the partial answer. */
  stop(): void
  /** True between dispatch and the IPC ask() resolving. */
  busy: boolean
}

/**
 * Single source of truth for firing an AI ask from any renderer surface
 * (dashboard AskPanel, overlay, chat). Encapsulates the ask + newRequest +
 * error handling + transcript-settle + model-override that used to be copied
 * into every call site — so settle and model-override now behave identically
 * everywhere.
 */
export function useAskRequest(): UseAskRequest {
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  // Mirror busy in a ref so `run` can guard re-entrancy without depending on
  // the rendered value (which would stale-close the callback).
  const busyRef = useRef(false)

  const run = useCallback(async (opts: AskRequestOptions): Promise<void> => {
    const p = opts.prompt.trim()
    const image = opts.image ?? null
    if ((!p && !image) || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const label = opts.label ?? p
    try {
      if (opts.waitForTranscript) await awaitTranscriptSettle()
      const askPrompt = p || SCREENSHOT_DEFAULT_PROMPT
      const { requestId } = await window.zanban.ai.ask({
        prompt: askPrompt,
        ...(image ? { imageDataUrl: image } : {}),
        ...(opts.ocr ? { ocrText: opts.ocr } : {}),
        ...(opts.modelOverride ? { modelOverride: opts.modelOverride } : {})
      })
      requestIdRef.current = requestId
      useAi.getState().newRequest(label, requestId)
    } catch (err) {
      const id = `err-${Date.now()}`
      useAi.getState().newRequest(label, id)
      useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const stop = useCallback((): void => {
    const id = requestIdRef.current
    if (id) void window.zanban.ai.stop(id)
  }, [])

  return { run, stop, busy }
}
