import { useEffect, useRef, useState } from 'react'
import { autoRecapJobId } from '@shared/recap-types'
import { useJobs } from '@renderer/features/jobs/jobsStore'
import { isRollingBackStart } from '@renderer/features/transcript/sessionStart'

interface Offer {
  sessionId: string
  /** Seen in the session list at least once, so a later absence means it was deleted. */
  listed: boolean
}

// Only the Stop button claims its stop (`claimNextStop`) and opens the call's
// recap. Any other stop (overlay, tray, hotkey, capture auto-stop) only becomes
// an offer: the overlay is stealth, so the dashboard must not move on its own
// while the screen may be shared, and a tray or hotkey stop can land while the
// user is reading another session.
export function useRecapAfterCall(
  open: (sessionId: string) => void,
  viewing: string | null,
  listedIds: ReadonlySet<string> | undefined
) {
  const [offer, setOffer] = useState<Offer | null>(null)
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
          setOffer(null)
          return
        }
        if (state.kind !== 'idle' || !liveId.current) return
        const sessionId = liveId.current
        const ownStop = claimed.current
        liveId.current = null
        if (isRollingBackStart()) return
        // The auto recap of an earlier stop of this session may have failed; its
        // finished marker must not pass for the one this stop is about to start.
        useJobs.getState().forget(autoRecapJobId(sessionId))
        // A call without speech is dropped on stop, so there is nothing to open.
        void window.zanban.sessions
          .read(sessionId)
          .catch(() => null)
          .then((record) => {
            if (!record) return
            if (ownStop) openRef.current(sessionId)
            else setOffer({ sessionId, listed: false })
          })
      }),
    []
  )

  if (offer) {
    if (offer.sessionId === viewing) {
      setOffer(null)
    } else if (listedIds) {
      const present = listedIds.has(offer.sessionId)
      if (present && !offer.listed) setOffer({ ...offer, listed: true })
      else if (!present && offer.listed) setOffer(null)
    }
  }

  function claimNextStop(): () => void {
    claimed.current = true
    return () => {
      claimed.current = false
    }
  }

  function openOffered(): void {
    if (offer) open(offer.sessionId)
  }

  return { offered: offer?.sessionId ?? null, claimNextStop, openOffered }
}
