import { clampOverlayWidth } from '../../shared/overlayLayout.js'

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

const TOP_MARGIN = 12
const PILL_HALF_WIDTH = 140
const PILL_CENTER_Y = 30
const PILL_HALF_HEIGHT = 18

function pillCenter(position: Point, width: number): Point {
  return { x: position.x + width / 2, y: position.y + PILL_CENTER_Y }
}

function contains(area: Rect, p: Point): boolean {
  return p.x >= area.x && p.x <= area.x + area.width && p.y >= area.y && p.y <= area.y + area.height
}

function distanceToArea(area: Rect, p: Point): number {
  const dx = Math.max(area.x - p.x, 0, p.x - (area.x + area.width))
  const dy = Math.max(area.y - p.y, 0, p.y - (area.y + area.height))
  return Math.hypot(dx, dy)
}

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.max(min, Math.min(max, value))
}

export function topCenterPosition(width: number, workArea: Rect): Point {
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + TOP_MARGIN
  }
}

/**
 * Keeps the status pill (centred at the top of the window) on some display.
 * Work areas are in global coordinates, so a monitor left of or above the
 * primary one has negative x or y. While the pill's centre is on any display
 * the position is left alone, so the window can straddle two monitors.
 */
export function clampOverlayPosition(position: Point, width: number, workAreas: Rect[]): Point {
  const center = pillCenter(position, width)
  if (workAreas.length === 0 || workAreas.some((a) => contains(a, center))) return position
  let nearest = workAreas[0]!
  for (const area of workAreas) {
    if (distanceToArea(area, center) < distanceToArea(nearest, center)) nearest = area
  }
  const cx = clamp(
    center.x,
    nearest.x + PILL_HALF_WIDTH,
    nearest.x + nearest.width - PILL_HALF_WIDTH
  )
  const cy = clamp(
    center.y,
    nearest.y + PILL_HALF_HEIGHT,
    nearest.y + nearest.height - PILL_HALF_HEIGHT
  )
  return { x: Math.round(cx - width / 2), y: Math.round(cy - PILL_CENTER_Y) }
}

/**
 * Where a new overlay window goes: the remembered spot while its pill is still
 * on a connected display, otherwise top-centre of the primary display.
 */
export function resolveOverlayBounds(
  saved: { position: Point | null; width: number },
  workAreas: Rect[],
  primary: Rect
): Point & { width: number } {
  const position = saved.position
  const home = position
    ? workAreas.find((a) => contains(a, pillCenter(position, saved.width)))
    : undefined
  if (position && home) {
    const width = clampOverlayWidth(saved.width, home.width)
    return { ...clampOverlayPosition(position, width, workAreas), width }
  }
  const width = clampOverlayWidth(saved.width, primary.width)
  return { ...topCenterPosition(width, primary), width }
}
