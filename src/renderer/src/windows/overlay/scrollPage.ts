const PAGE_FRACTION = 0.8

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Scrolls by most of the visible height, so the last line seen stays in view. No-op when nothing overflows. */
export function scrollPage(el: HTMLElement | null, direction: 'up' | 'down'): void {
  if (!el || el.scrollHeight <= el.clientHeight) return
  const sign = direction === 'down' ? 1 : -1
  el.scrollBy({
    top: sign * el.clientHeight * PAGE_FRACTION,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth'
  })
}
