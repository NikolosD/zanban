import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

const MORE_BELOW_SLACK_PX = 4

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * The answer's scroll area. While more of the answer waits below the fold the
 * bottom edge fades out and a small hint says so; clicking it scrolls on.
 * `contentKey` changes whenever the content may have grown.
 */
export function AnswerScroller({
  maxHeight,
  contentKey,
  ref,
  children
}: {
  maxHeight: number
  contentKey: unknown
  ref?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  const measure = useCallback((): void => {
    const el = innerRef.current
    if (!el) return
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > MORE_BELOW_SLACK_PX)
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [measure, contentKey, maxHeight])

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [measure])

  function setRefs(el: HTMLDivElement | null): void {
    innerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  function scrollOn(): void {
    const el = innerRef.current
    if (!el) return
    el.scrollBy({
      top: el.clientHeight * 0.8,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    })
  }

  return (
    <div className="relative min-w-0">
      <div
        ref={setRefs}
        data-interactive
        data-more-below={moreBelow}
        onScroll={measure}
        style={{ maxHeight: `${maxHeight}px` }}
        className={cn(
          'flex min-w-0 flex-col overflow-y-auto overflow-x-hidden px-1',
          moreBelow && '[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]'
        )}
      >
        {children}
      </div>
      {moreBelow && (
        <button
          type="button"
          data-interactive
          onClick={scrollOn}
          className={cn(
            'absolute bottom-1 right-2 inline-flex items-center rounded-full px-2 py-0.5',
            'border border-white/10 bg-white/[0.08] font-mono text-small lowercase',
            'text-foreground/80 transition-colors hover:bg-white/[0.14] hover:text-foreground'
          )}
        >
          {t('overlay.more_below')}
        </button>
      )}
    </div>
  )
}
