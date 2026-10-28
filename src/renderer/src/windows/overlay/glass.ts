import type { CSSProperties } from 'react'

const MIN_OPACITY = 0.4
const MIN_ALPHA = 0.6
const MAX_ALPHA = 0.95

/**
 * Maps the Interface Opacity setting (0.4–1) to the overlay glass alpha
 * (0.6–0.95). Only the glass background reads it — text stays fully opaque.
 */
export function overlayGlassAlpha(opacity: number): number {
  const t = (Math.min(1, Math.max(MIN_OPACITY, opacity)) - MIN_OPACITY) / (1 - MIN_OPACITY)
  return Math.round((MIN_ALPHA + t * (MAX_ALPHA - MIN_ALPHA)) * 1000) / 1000
}

export function overlayGlassVars(opacity: number): CSSProperties {
  return { '--overlay-glass': overlayGlassAlpha(opacity) } as CSSProperties
}

export const GLASS_PANEL =
  'bg-[oklch(0.13_0.012_260/var(--overlay-glass,0.84))] backdrop-blur-2xl backdrop-saturate-150'

export const GLASS_PILL =
  'bg-[oklch(0.13_0.012_260/calc(var(--overlay-glass,0.84)*0.85))] backdrop-blur-2xl backdrop-saturate-150'
