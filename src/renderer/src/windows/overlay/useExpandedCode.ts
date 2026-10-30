import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ExpandedCode } from '@renderer/features/ai/CodeBlock'

function visibleHeight(block: Element, view: DOMRect): number {
  const rect = block.getBoundingClientRect()
  return Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top)
}

/** The code block showing most inside the scroller, or the last one when none shows. */
export function pickCodeBlock(scroller: HTMLElement): HTMLElement | null {
  const blocks = Array.from(scroller.querySelectorAll<HTMLElement>('.zb-codeblock'))
  const view = scroller.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestHeight = 0
  for (const block of blocks) {
    const height = visibleHeight(block, view)
    if (height > bestHeight) {
      best = block
      bestHeight = height
    }
  }
  return best ?? blocks.at(-1) ?? null
}

/**
 * One code block shown larger. Main grows the window to the display's work
 * area; collapsing restores the window and the answer's scroll position.
 */
export function useExpandedCode(answerScrollRef: React.RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState<ExpandedCode | null>(null)
  const open = useRef(false)
  const savedScroll = useRef<number | null>(null)

  const expand = useCallback(
    async (block: ExpandedCode): Promise<void> => {
      if (open.current) return
      open.current = true
      savedScroll.current = answerScrollRef.current?.scrollTop ?? 0
      await window.zanban.overlay.setExpanded(true)
      setExpanded(block)
    },
    [answerScrollRef]
  )

  const collapse = useCallback(async (): Promise<void> => {
    if (!open.current) return
    open.current = false
    await window.zanban.overlay.setExpanded(false)
    setExpanded(null)
  }, [])

  const toggle = useCallback((): void => {
    if (open.current) {
      void collapse()
      return
    }
    const scroller = answerScrollRef.current
    const button =
      scroller && pickCodeBlock(scroller)?.querySelector<HTMLElement>('[data-code-expand]')
    button?.click()
  }, [answerScrollRef, collapse])

  useLayoutEffect(() => {
    const scroller = answerScrollRef.current
    if (expanded || savedScroll.current === null || !scroller) return
    scroller.scrollTop = savedScroll.current
    savedScroll.current = null
  }, [expanded, answerScrollRef])

  useEffect(() => {
    if (!expanded) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.preventDefault()
      void collapse()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [expanded, collapse])

  return { expanded, expand, collapse, toggle }
}
