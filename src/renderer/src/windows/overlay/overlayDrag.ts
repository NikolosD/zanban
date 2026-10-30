import { useCallback } from 'react'

const NOT_DRAGGABLE =
  'button,a,input,textarea,select,label,[contenteditable="true"],[data-no-drag],' +
  '[role="separator"],[role="menu"],[role="menuitem"],[role="dialog"],' +
  '[data-radix-popper-content-wrapper]'

/** Left button on bare chrome; controls, text to select and resize handles keep their own mouse. */
export function shouldStartOverlayDrag(e: { button: number; target: EventTarget | null }): boolean {
  if (e.button !== 0) return false
  return e.target instanceof Element && !e.target.closest(NOT_DRAGGABLE)
}

export function useOverlayDrag(): (e: React.MouseEvent<HTMLElement>) => void {
  return useCallback((e) => {
    // Portaled menus and tooltips bubble through React to the panel but sit outside it.
    if (!e.currentTarget.contains(e.target as Node) || !shouldStartOverlayDrag(e)) return
    e.preventDefault()
    void window.zanban.overlay.dragStart()
    const end = (): void => {
      window.removeEventListener('mouseup', end)
      window.removeEventListener('blur', end)
      void window.zanban.overlay.dragEnd()
    }
    window.addEventListener('mouseup', end)
    window.addEventListener('blur', end)
  }, [])
}
