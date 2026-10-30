export const BACKGROUNDS = ['web-light', 'ide-dark', 'video-grid']

// Runs inside the overlay page (serialized with toString): paints a desktop
// stand-in on a canvas and returns it as a PNG data URL. Seeded, so every
// build is scored against identical pixels.
export function paintBackground(kind, w, h) {
  let seed = 1234567
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const words = (
    'the function returns a value when props change and state updates render again so each ' +
    'component should stay pure while effects run after commit because React batches updates ' +
    'before painting which means refs hold stale data unless dependencies are listed correctly'
  ).split(' ')
  const sentence = (n) =>
    Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ')

  if (kind === 'web-light') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#f1f3f5'
    ctx.fillRect(0, 0, w, 44)
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 15px Arial'
    ctx.fillText('Problem 214 - Fix the component', 16, 28)
    ctx.font = '13px Georgia'
    let y = 70
    while (y < h - 10) {
      ctx.fillStyle = '#000000'
      ctx.fillText(sentence(18), 16, y)
      y += 17
      if (y > 330 && y < 336) {
        ctx.fillStyle = '#fdecea'
        ctx.fillRect(12, y, w - 24, 76)
        ctx.strokeStyle = '#d32f2f'
        ctx.lineWidth = 2
        ctx.strokeRect(12, y, w - 24, 76)
        ctx.fillStyle = '#c62828'
        ctx.font = 'bold 14px monospace'
        ctx.fillText('SyntaxError: Adjacent JSX elements must be wrapped', 24, y + 28)
        ctx.font = '13px monospace'
        ctx.fillText('in an enclosing tag. Did you want a JSX fragment <>...</>?', 24, y + 50)
        ctx.font = '13px Georgia'
        y += 92
      }
    }
  } else if (kind === 'ide-dark') {
    ctx.fillStyle = '#1e1e1e'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#252526'
    ctx.fillRect(0, 0, w, 30)
    ctx.fillStyle = '#2d2d30'
    ctx.fillRect(0, 0, 48, h)
    ctx.font = '13px Consolas, monospace'
    const palette = ['#569cd6', '#ce9178', '#6a9955', '#4ec9b0', '#dcdcaa', '#9cdcfe', '#d4d4d4']
    let y = 52
    let n = 1
    while (y < h - 6) {
      ctx.fillStyle = '#858585'
      ctx.fillText(String(n).padStart(3, ' '), 10, y)
      let x = 64 + Math.floor(rand() * 3) * 16
      const parts = 3 + Math.floor(rand() * 6)
      for (let i = 0; i < parts; i++) {
        const tok = words[Math.floor(rand() * words.length)] + (rand() < 0.3 ? '()' : '')
        ctx.fillStyle = palette[Math.floor(rand() * palette.length)]
        ctx.fillText(tok, x, y)
        x += ctx.measureText(tok).width + 8
      }
      y += 18
      n++
    }
  } else {
    ctx.fillStyle = '#10131a'
    ctx.fillRect(0, 0, w, h)
    const cols = 3
    const rows = Math.max(3, Math.ceil(h / 220))
    const gap = 6
    const tw = (w - gap * (cols + 1)) / cols
    const th = (h - gap * (rows + 1)) / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = gap + c * (tw + gap)
        const y = gap + r * (th + gap)
        const hue = Math.floor(rand() * 360)
        const light = 30 + Math.floor(rand() * 35)
        const grad = ctx.createLinearGradient(x, y, x + tw, y + th)
        grad.addColorStop(0, `hsl(${hue} 35% ${light + 10}%)`)
        grad.addColorStop(1, `hsl(${(hue + 40) % 360} 30% ${light - 8}%)`)
        ctx.fillStyle = grad
        ctx.fillRect(x, y, tw, th)
        ctx.fillStyle = `hsl(${(hue + 20) % 360} 25% ${light + 18}%)`
        ctx.beginPath()
        ctx.arc(x + tw / 2, y + th * 0.42, th * 0.22, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(x + tw * 0.25, y + th * 0.64, tw * 0.5, th * 0.36)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(x + 6, y + th - 24, 86, 18)
        ctx.fillStyle = '#ffffff'
        ctx.font = '11px Arial'
        ctx.fillText(`Participant ${r * cols + c + 1}`, x + 12, y + th - 11)
      }
    }
  }
  return canvas.toDataURL('image/png')
}
