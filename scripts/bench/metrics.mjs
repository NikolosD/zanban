export function srgbToLinear(c) {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

export function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

export function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function mean(values) {
  const xs = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v))
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}

function lumaAt(bitmap, x, y) {
  const i = (y * bitmap.width + x) * 4
  return luminance(bitmap.data[i], bitmap.data[i + 1], bitmap.data[i + 2])
}

function clampRect(bitmap, rect) {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(bitmap.width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(bitmap.height, Math.ceil(rect.y + rect.h))
  return { x0, y0, x1, y1 }
}

/**
 * WCAG contrast of the glyph core in `rect` against the median luminance of the
 * ring of pixels around it. The core is the mean of the `topFrac` pixels that
 * differ most from that surround, so anti-aliasing does not dilute the result.
 */
export function rectContrast(bitmap, rect, { ring = 3, topFrac = 0.1 } = {}) {
  const inner = clampRect(bitmap, rect)
  const outer = clampRect(bitmap, {
    x: rect.x - ring,
    y: rect.y - ring,
    w: rect.w + ring * 2,
    h: rect.h + ring * 2
  })
  if (inner.x1 - inner.x0 < 1 || inner.y1 - inner.y0 < 1) return null
  const around = []
  for (let y = outer.y0; y < outer.y1; y++) {
    for (let x = outer.x0; x < outer.x1; x++) {
      const inside = x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1
      if (!inside) around.push(lumaAt(bitmap, x, y))
    }
  }
  if (around.length === 0) return null
  const bg = percentile(around, 0.5)
  const core = []
  for (let y = inner.y0; y < inner.y1; y++) {
    for (let x = inner.x0; x < inner.x1; x++) core.push(lumaAt(bitmap, x, y))
  }
  core.sort((a, b) => Math.abs(b - bg) - Math.abs(a - bg))
  const take = Math.max(1, Math.round(core.length * topFrac))
  let fg = 0
  for (let i = 0; i < take; i++) fg += core[i]
  return contrastRatio(fg / take, bg)
}

/**
 * Mean gradient of display luma (|dx| + |dy|, sRGB 0-255 levels) over `region`,
 * skipping pixels inside any of `maskRects`. Flat areas score 0.
 */
export function edgeEnergy(bitmap, region, maskRects = []) {
  const box = clampRect(bitmap, region)
  const masks = maskRects.map((m) => clampRect(bitmap, m))
  const luma = (x, y) => {
    const i = (y * bitmap.width + x) * 4
    return 0.2126 * bitmap.data[i] + 0.7152 * bitmap.data[i + 1] + 0.0722 * bitmap.data[i + 2]
  }
  let sum = 0
  let count = 0
  for (let y = box.y0; y < Math.min(box.y1, bitmap.height - 1); y++) {
    for (let x = box.x0; x < Math.min(box.x1, bitmap.width - 1); x++) {
      if (masks.some((m) => x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1)) continue
      const l = luma(x, y)
      sum += Math.abs(luma(x + 1, y) - l) + Math.abs(luma(x, y + 1) - l)
      count++
    }
  }
  return count === 0 ? 0 : sum / count
}

/**
 * Where a text rect sits against its clipping box [x0, y0, x1, y1]:
 * visible, cutV (cut at the top/bottom edge), cutH (cut at the sides) or hidden.
 */
export function classifyRect(rect, clip, tol = 0.75) {
  const [cx0, cy0, cx1, cy1] = clip
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  if (right <= cx0 || left >= cx1 || bottom <= cy0 || top >= cy1) return 'hidden'
  const cutH = left < cx0 - tol || right > cx1 + tol
  const cutV = top < cy0 - tol || bottom > cy1 + tol
  if (cutH) return 'cutH'
  if (cutV) return 'cutV'
  return 'visible'
}

export function intersectRect(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

export function toRect([x, y, w, h]) {
  return { x, y, w, h }
}

/**
 * Turns the in-page probe plus the bitmaps for one background into the
 * per-case metrics. `shots` holds the `withBg`, `flat` and `bgOnly` bitmaps.
 */
export function scoreCase(probe, shots) {
  const words = probe.words.map((w) => {
    const rect = toRect(w.r)
    return { ...w, rect, state: classifyRect(rect, w.clip) }
  })
  const totalChars = words.reduce((n, w) => n + w.t.length, 0)
  const visible = words.filter((w) => w.state === 'visible')
  const visibleChars = visible.reduce((n, w) => n + w.t.length, 0)

  const ratios = visible.map((w) => rectContrast(shots.withBg, w.rect)).filter((r) => r !== null)

  const region = intersectRect(toRect(probe.scroller.rect), {
    x: 0,
    y: 0,
    w: probe.viewport.w,
    h: probe.viewport.h
  })
  const pad = 2
  const mask = visible.map((w) => ({
    x: w.rect.x - pad,
    y: w.rect.y - pad,
    w: w.rect.w + pad * 2,
    h: w.rect.h + pad * 2
  }))
  const eBg = edgeEnergy(shots.withBg, region, mask)
  const eFlat = edgeEnergy(shots.flat, region, mask)
  const eRef = edgeEnergy(shots.bgOnly, region, mask)
  const bleed = eRef > 0 ? Math.min(1, Math.max(0, (eBg - eFlat) / eRef)) : 0

  const cutLines = new Set(words.filter((w) => w.state === 'cutV').map((w) => Math.round(w.rect.y)))
  const hClipped = words.filter((w) => w.state === 'cutH').length

  const sizes = (kind) => words.filter((w) => w.kind === kind).map((w) => w.fs)
  const codePx = percentile(sizes('code'), 0.5)
  const bodyPx = percentile(sizes('body'), 0.5)

  const v = probe.verdict
  const verdictVisible = v
    ? classifyRect({ x: v.x, y: v.y, w: v.w, h: v.fs * 1.4 }, v.clip) === 'visible'
    : null

  const panelArea = probe.panel.w * probe.panel.h
  const answerArea = region.w * region.h

  return {
    contrastMedian: percentile(ratios, 0.5),
    contrastP10: percentile(ratios, 0.1),
    bleed,
    edge: { eBg, eFlat, eRef },
    aboveFold: totalChars === 0 ? 0 : visibleChars / totalChars,
    verdictY: probe.verdict ? probe.verdict.y : null,
    verdictVisible: verdictVisible === null ? null : verdictVisible ? 1 : 0,
    verdictFont: probe.verdict ? probe.verdict.fs : null,
    verdictSource: probe.verdict ? probe.verdict.source : null,
    cutLines: cutLines.size,
    hClipped,
    answerShare: panelArea === 0 ? 0 : answerArea / panelArea,
    codePx,
    bodyPx,
    codeToBody: codePx !== null && bodyPx ? codePx / bodyPx : null,
    wordsMeasured: ratios.length,
    totalChars
  }
}
