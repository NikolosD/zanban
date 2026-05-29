/**
 * Resolve with `promise`'s value if it settles within `ms`, otherwise resolve
 * with `fallback`. A rejection is treated like a timeout — caller gets the
 * fallback, never a throw. Used to keep optional augmentation (web search) off
 * the critical path of a streamed answer.
 */
export function raceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const done = (value: T): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => done(fallback), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        done(value)
      })
      .catch(() => {
        clearTimeout(timer)
        done(fallback)
      })
  })
}
