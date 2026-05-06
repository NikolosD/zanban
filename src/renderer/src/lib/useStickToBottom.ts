import { useEffect, useRef } from 'react'

// Pins a scroll container to its bottom edge while content grows, but
// releases the pin the moment the user scrolls up to read older content.
// Two signals drive it: `resetKey` (e.g. a new message id) snaps to bottom
// and re-arms the pin; `growKey` (e.g. streaming text length) re-applies the
// pin while the latest chunk is being appended.
export function useStickToBottom<T extends HTMLElement>(
  resetKey: string | number | null | undefined,
  growKey: string | number | null | undefined,
  // For Radix ScrollArea the scrollable element is a descendant viewport,
  // not the ref'd root. Callers pass a resolver to point us at it. The
  // resolver is captured once via ref so callers can pass an inline arrow
  // without forcing effect re-runs on every render.
  resolveScrollEl?: (root: T) => HTMLElement | null
): {
  rootRef: React.MutableRefObject<T | null>
} {
  const rootRef = useRef<T | null>(null)
  const stickRef = useRef(true)
  const resolverRef = useRef(resolveScrollEl)
  resolverRef.current = resolveScrollEl

  function getScrollEl(): HTMLElement | null {
    const root = rootRef.current
    if (!root) return null
    const r = resolverRef.current
    return r ? r(root) : root
  }

  useEffect(() => {
    const el = getScrollEl()
    if (!el) return
    const handler = (): void => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      stickRef.current = dist < 32
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [resetKey])

  useEffect(() => {
    stickRef.current = true
    const el = getScrollEl()
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [resetKey])

  useEffect(() => {
    if (!stickRef.current) return
    const el = getScrollEl()
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [growKey])

  return { rootRef }
}
