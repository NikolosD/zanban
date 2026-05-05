import { lazy, Suspense } from 'react'

// Heavy deps (react-markdown + highlight.js + remark-gfm) live in the impl
// module so they only land in the bundle on first answer render. Until then
// we show the raw text in a monospace placeholder — same vertical rhythm as
// the rendered version, so the UI doesn't jump.
const StreamingMarkdownImpl = lazy(() => import('./StreamingMarkdownImpl'))

export function StreamingMarkdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<MarkdownFallback text={text} />}>
      <StreamingMarkdownImpl text={text} />
    </Suspense>
  )
}

function MarkdownFallback({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-mono">
      {text}
    </div>
  )
}
