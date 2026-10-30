const SHORT_CODE_CHARS = 24

const BASE =
  'rounded bg-white/[0.06] border border-white/[0.06] px-1.5 py-0.5 text-[0.85em] font-mono text-foreground'

/** A short token such as `<div>` must never split across lines; a long one wraps at word breaks. */
export function inlineCodeClass(children: React.ReactNode): string {
  const short = typeof children === 'string' && children.length < SHORT_CODE_CHARS
  return `${short ? 'whitespace-nowrap' : 'break-words'} ${BASE}`
}
