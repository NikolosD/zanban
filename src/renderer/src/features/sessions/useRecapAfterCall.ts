import { useEffect, useRef, useState } from 'react'

// A stop issued from this window (`claimNextStop`) opens the call's recap. A
// stop from anywhere else, the overlay included, only becomes an offer: the
// overlay is stealth, so the dashboard must not move on its own while the
// screen may be shared.
export function useRecapAfterCall(open: (sessionId: string) => void, viewing: string | null) {
  const [offered, setOffered] = useState<string | null>(null)
  const liveId = useRef<string | null>(null)
  const claimed = useRef(false)
  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  })

  useEffect(
    () =>
      window.zanban.session.onState((state) => {
        if (state.kind === 'running') {
          liveId.current = state.sessionId
          setOffered(null)
          return
        }
        if (state.kind !== 'idle' || !liveId.current) return
        const sessionId = liveId.current
        const ownStop = claimed.current
        liveId.current = null
        // A call without speech is dropped on stop, so there is nothing to open.
        void window.zanban.sessions
          .read(sessionId)
          .catch(() => null)
          .then((record) => {
            if (!record) return
            if (ownStop) openRef.current(sessionId)
            else setOffered(sessionId)
          })
      }),
    []
  )

  if (offered !== null && offered === viewing) setOffered(null)

  function claimNextStop(): () => void {
    claimed.current = true
    return () => {
      claimed.current = false
    }
  }

  function openOffered(): void {
    if (offered) open(offered)
    setOffered(null)
  }

  return { offered, claimNextStop, openOffered }
}
