import { capturePrimaryDisplay } from './capture.js'
import { runOcr } from './ocrPipeline.js'

export interface ScreenContext {
  dataUrl: string
  ocrText: string | null
}

/**
 * Single-shot capture-and-OCR. The image is returned as soon as it is
 * grabbed; OCR runs in parallel and may return null if the worker can't
 * start (in which case the caller still has the image — it is sent to the
 * vision-capable LLM directly).
 */
export async function captureWithOcr(): Promise<ScreenContext | null> {
  const dataUrl = await capturePrimaryDisplay()
  if (!dataUrl) return null
  const ocrText = await runOcr(dataUrl)
  return { dataUrl, ocrText }
}
