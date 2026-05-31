import { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function CropperApp() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.zanban.cropper.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true
    const x = e.clientX
    const y = e.clientY
    setStart({ x, y })
    setRect({ x, y, w: 0, h: 0 })
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current || !start) return
    const x = Math.min(e.clientX, start.x)
    const y = Math.min(e.clientY, start.y)
    const w = Math.abs(e.clientX - start.x)
    const h = Math.abs(e.clientY - start.y)
    setRect({ x, y, w, h })
  }

  function onMouseUp() {
    dragging.current = false
    if (rect && rect.w > 4 && rect.h > 4) {
      // Send the selection in CSS px tagged with this window's DPR. Main
      // reconciles it against the captured image's scaleFactor and clamps to
      // the source bounds (see cropGeometry) — doing the scale here is what
      // caused the DPR/scaleFactor mismatch on Windows at 125%/150%.
      void window.zanban.cropper.submit({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        dpr: window.devicePixelRatio
      })
    } else {
      void window.zanban.cropper.cancel()
    }
  }

  return (
    <div
      className="fixed inset-0 select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        background: rect
          ? `linear-gradient(transparent, transparent), rgba(0, 0, 0, 0.35)`
          : 'rgba(0, 0, 0, 0.25)'
      }}
    >
      {/* Selection rectangle with a punch-through effect */}
      {rect && (
        <>
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              border: '1px solid rgba(80, 220, 160, 0.95)',
              boxShadow: '0 0 0 4000px rgba(0, 0, 0, 0.45)',
              background: 'transparent'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y - 22,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              background: 'rgba(0,0,0,0.5)',
              padding: '2px 6px',
              borderRadius: 4
            }}
          >
            {rect.w} × {rect.h} — release to capture · Esc to cancel
          </div>
        </>
      )}
      {!rect && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            background: 'rgba(0,0,0,0.55)',
            padding: '6px 12px',
            borderRadius: 999
          }}
        >
          Drag to select a region · Esc to cancel
        </div>
      )}
    </div>
  )
}
