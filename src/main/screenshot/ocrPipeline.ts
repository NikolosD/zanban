import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { IdleResource } from '../services/idleResource.js'
import { trackJob } from '../services/jobsManager.js'

type TesseractWorker = {
  recognize(image: string | Buffer): Promise<{ data: { text: string; confidence?: number } }>
  terminate(): Promise<void>
}

const OCR_IDLE_MS = 3 * 60_000

/**
 * A single lazily created Tesseract worker for OCR. The worker download happens
 * once (per language) and is cached by tesseract.js inside the user data
 * directory we hand it. Recognitions reuse the same worker so latency drops
 * from ~2-3 s on first call to ~500 ms after that; it is terminated after a
 * few idle minutes, since screenshots come in bursts.
 *
 * Languages: English + Russian by default. Tesseract auto-handles mixed text
 * inside a single image when both are loaded.
 */
const ocrWorker = new IdleResource<TesseractWorker>({
  load: async () => {
    const mod = await import('tesseract.js')
    const { createWorker } = mod as unknown as {
      createWorker: (
        langs: string,
        oem?: number,
        opts?: { cachePath?: string; logger?: (m: unknown) => void }
      ) => Promise<TesseractWorker>
    }
    const cachePath = app.getPath('userData') + '/tesseract'
    return createWorker('eng+rus', 1, {
      cachePath,
      logger: () => {}
    })
  },
  dispose: (worker) => worker.terminate(),
  idleMs: OCR_IDLE_MS
})

/**
 * Run OCR on a base64 PNG data URL. Returns the recognized text trimmed of
 * leading/trailing whitespace, or null if the worker could not be initialized
 * or recognition failed.
 *
 * This is best-effort — a failure here should never block the underlying
 * screenshot flow; callers should fall back to imageDataUrl-only.
 */
export async function runOcr(imageDataUrl: string): Promise<string | null> {
  let worker: TesseractWorker
  try {
    worker = await ocrWorker.acquire()
  } catch (err) {
    console.error('[ocr] worker init failed', err)
    return null
  }
  try {
    return await trackJob(`ocr-${randomUUID()}`, 'Running OCR', 'ocr', async () => {
      try {
        const { data } = await worker.recognize(imageDataUrl)
        const text = data.text.trim()
        return text.length > 0 ? text : null
      } catch (err) {
        console.error('[ocr] recognize failed', err)
        return null
      }
    })
  } finally {
    ocrWorker.release()
  }
}

export async function terminateOcrWorker(): Promise<void> {
  await ocrWorker.close().catch(() => {})
}
