// Runs inside the overlay page (serialized with toString), so it must stay
// self-contained. Returns CSS-pixel geometry only; scoring happens in Node.
export function probe({ firstAnchor, lastAnchor, viewportH }) {
  // Bench-only hook: main's lead slot is [data-testid="answer-lead"]; a branch may use [data-say].
  const SAY = '[data-say], [data-testid="answer-lead"]'
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  const first = textNodes.find((n) => n.data.includes(firstAnchor))
  const last = [...textNodes].reverse().find((n) => n.data.includes(lastAnchor))
  if (!first || !last) return { found: false }

  const common = (a, b) => {
    const chain = new Set()
    for (let n = a; n; n = n.parentNode) chain.add(n)
    for (let n = b; n; n = n.parentNode) if (chain.has(n)) return n
    return document.body
  }
  let root = common(first, last)
  if (root.nodeType !== 1) root = root.parentElement

  const viewport = { w: window.innerWidth, h: viewportH }
  const rectOf = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })

  const clipOf = (el) => {
    let x0 = 0
    let y0 = 0
    let x1 = viewport.w
    let y1 = viewport.h
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const r = n.getBoundingClientRect()
      if (cs.overflowX !== 'visible') {
        x0 = Math.max(x0, r.left + n.clientLeft)
        x1 = Math.min(x1, r.left + n.clientLeft + n.clientWidth)
      }
      if (cs.overflowY !== 'visible') {
        y0 = Math.max(y0, r.top + n.clientTop)
        y1 = Math.min(y1, r.top + n.clientTop + n.clientHeight)
      }
    }
    return [x0, y0, x1, y1]
  }

  const hidden = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden') return true
    }
    return false
  }

  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgbaOf = (css) => {
    swatch.clearRect(0, 0, 1, 1)
    swatch.fillStyle = '#000'
    swatch.fillStyle = css
    swatch.fillRect(0, 0, 1, 1)
    const d = swatch.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }

  const kindOf = (el) => {
    if (el.closest('pre')) return 'code'
    if (el.closest('code')) return 'inline-code'
    if (el.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th')) return 'body'
    return 'other'
  }

  const nodes = []
  const inRoot = textNodes.filter((n) => root.contains(n))
  const say = document.querySelector(SAY)
  const extra = say && !root.contains(say) ? textNodes.filter((n) => say.contains(n)) : []
  for (const n of [...extra, ...inRoot]) nodes.push(n)

  const words = []
  for (const n of nodes) {
    const el = n.parentElement
    if (!el || hidden(el) || el.closest('button')) continue
    const clip = clipOf(el)
    const fs = parseFloat(getComputedStyle(el).fontSize)
    const kind = kindOf(el)
    const re = /\S+/g
    let m
    while ((m = re.exec(n.data))) {
      const range = document.createRange()
      range.setStart(n, m.index)
      range.setEnd(n, m.index + m[0].length)
      const r = range.getClientRects()[0]
      if (!r || r.width === 0 || r.height === 0) continue
      words.push({
        t: m[0],
        r: [r.left, r.top, r.width, r.height],
        clip,
        fs,
        kind,
        sel: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`,
        color: getComputedStyle(el).color,
        rgba: rgbaOf(getComputedStyle(el).color)
      })
    }
  }

  const scrollerEl = (() => {
    for (let n = root; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') return n
    }
    return root
  })()
  const fadePx = (el) => {
    const mask = getComputedStyle(el).maskImage
    if (!mask || mask === 'none') return 0
    const m = /calc\(100% - (\d+)px\)/.exec(mask)
    return m ? Number(m[1]) : 24
  }
  const scrollerRect = scrollerEl.getBoundingClientRect()

  const verdictEl =
    document.querySelector(SAY) ??
    [...root.querySelectorAll('p')].find((p) => !p.closest('pre, blockquote')) ??
    root.firstElementChild ??
    root
  const vr = verdictEl.getBoundingClientRect()
  const verdict = {
    y: vr.top,
    x: vr.left,
    w: vr.width,
    clip: clipOf(verdictEl),
    fs: parseFloat(getComputedStyle(verdictEl).fontSize),
    source: verdictEl.matches(SAY) ? 'say' : 'first-paragraph',
    text: (verdictEl.textContent ?? '').slice(0, 80)
  }

  const panelEl = scrollerEl.closest('.pointer-events-auto') ?? document.getElementById('root')
  const panel = rectOf(panelEl.getBoundingClientRect())

  return {
    found: true,
    viewport,
    scroller: {
      rect: [scrollerRect.left, scrollerRect.top, scrollerRect.width, scrollerRect.height],
      fadePx: fadePx(scrollerEl),
      scrollHeight: scrollerEl.scrollHeight,
      clientHeight: scrollerEl.clientHeight
    },
    panel,
    verdict,
    words
  }
}
