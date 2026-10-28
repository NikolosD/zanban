import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScreenSnapshot } from '@shared/types'

export interface ScreenshotAttachment {
  image: string | null
  ocrText: string | null
  snapping: boolean
  attach(snap: ScreenSnapshot): void
  /** Capture the primary display and attach it. Resolves true when attached. */
  snap(): Promise<boolean>
  clear(): void
}

/**
 * Screenshot attachment for an Ask input: the image attaches at once and the
 * background OCR text folds in when it lands — but only into the snapshot
 * still attached, never one the user already cleared or replaced.
 */
export function useScreenshotAttachment(): ScreenshotAttachment {
  const [image, setImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [snapping, setSnapping] = useState(false)
  const snapshotIdRef = useRef<string | null>(null)

  useEffect(
    () =>
      window.zanban.screenshot.onOcr((result) => {
        if (result.snapshotId === snapshotIdRef.current) setOcrText(result.ocrText)
      }),
    []
  )

  const attach = useCallback((snap: ScreenSnapshot): void => {
    snapshotIdRef.current = snap.snapshotId
    setImage(snap.dataUrl)
    setOcrText(snap.ocrText)
  }, [])

  const clear = useCallback((): void => {
    snapshotIdRef.current = null
    setImage(null)
    setOcrText(null)
  }, [])

  async function snap(): Promise<boolean> {
    if (snapping) return false
    setSnapping(true)
    try {
      const shot = await window.zanban.screenshot.captureInstant()
      if (!shot) return false
      attach(shot)
      return true
    } finally {
      setSnapping(false)
    }
  }

  return { image, ocrText, snapping, attach, snap, clear }
}
