import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { trackJob } from '../services/jobsManager.js'

type TesseractWorker = {
  recognize(image: string | Buffer): Promise<{ data: { text: string; confidence?: number } }>
  terminate(): Promise<void>
}

let workerPromise: Promise<TesseractWorker | null> | null = null

/**
 * Lazy-init a single Tesseract worker for OCR. The worker download happens
 * once (per language) and is cached by tesseract.js inside the user data
 * directory we hand it. Subsequent recognitions reuse the same worker so
 * latency drops from ~2-3 s on first call to ~500 ms after that.
 *
 * Languages: English + Russian by default. Tesseract auto-handles mixed text
 * inside a single image when both are loaded.
 */
async function getWorker(): Promise<TesseractWorker | null> {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    try {
      const mod = await import('tesseract.js')
      const { createWorker } = mod as unknown as {
        createWorker: (
          langs: string,
          oem?: number,
          opts?: { cachePath?: string; logger?: (m: unknown) => void }
        ) => Promise<TesseractWorker>
      }
      const cachePath = app.getPath('userData') + '/tesseract'
      return await createWorker('eng+rus', 1, {
        cachePath,
        logger: () => {}
      })
    } catch (err) {
      console.error('[ocr] worker init failed', err)
      return null
    }
  })()
  return workerPromise
}

/**
 * Run OCR on a base64 PNG data URL. Returns the recognized text trimmed of
 * leading/trailing whitespace, or null if the worker could not be initialized
 * or recognition failed.
 *
 * This is best-effort — a failure here should never block the underlying
 * screenshot flow; callers should fall back to imageDataUrl-only.
 */
export async function runOcr(imageDataUrl: string): Promise<string | null> {
  const worker = await getWorker()
  if (!worker) return null
  return trackJob(`ocr-${randomUUID()}`, 'Running OCR', 'ocr', async () => {
    try {
      const { data } = await worker.recognize(imageDataUrl)
      const text = data.text.trim()
      return text.length > 0 ? text : null
    } catch (err) {
      console.error('[ocr] recognize failed', err)
      return null
    }
  })
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return
  const w = await workerPromise
  workerPromise = null
  if (w) await w.terminate().catch(() => {})
}
