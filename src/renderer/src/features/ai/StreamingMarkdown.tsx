import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/atom-one-dark.css'
import './streamingMarkdown.css'

const components = {
  // react-markdown v9 dropped the `inline` prop, so we detect block code by:
  // 1) presence of a `language-*` className from a fenced block, or
  // 2) the content containing a newline. Otherwise it's inline.
  code(props: { className?: string; children?: React.ReactNode }) {
    const { className, children } = props
    const hasLang = /(^|\s)language-/.test(className ?? '')
    const isMultiline = typeof children === 'string' && children.includes('\n')
    if (hasLang || isMultiline) {
      return (
        <code
          className={`hljs block whitespace-pre overflow-x-auto rounded-lg p-3 text-[12px] leading-[1.55] font-mono ${className ?? ''}`}
        >
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-white/[0.06] border border-white/[0.06] px-1.5 py-0.5 text-[0.85em] font-mono text-foreground">
        {children}
      </code>
    )
  },
  pre(props: { children?: React.ReactNode }) {
    // Pull the language tag from the inner <code>'s className, if any, to
    // render a small badge in the top-right.
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    const cls =
      (child as { props?: { className?: string } } | undefined)?.props?.className ?? ''
    const langMatch = cls.match(/language-([\w-]+)/)
    const lang = langMatch?.[1]
    return (
      <div className="zb-codeblock relative my-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]">
        {lang && (
          <div className="pointer-events-none absolute right-2 top-1.5 select-none rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {lang}
          </div>
        )}
        <pre className="m-0 overflow-x-auto bg-transparent p-0">{props.children}</pre>
      </div>
    )
  },
  ul(props: { children?: React.ReactNode }) {
    return <ul className="my-1 list-disc pl-4">{props.children}</ul>
  },
  ol(props: { children?: React.ReactNode }) {
    return <ol className="my-1 list-decimal pl-4">{props.children}</ol>
  },
  p(props: { children?: React.ReactNode }) {
    return <p className="my-1 leading-snug">{props.children}</p>
  },
  a(props: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={props.href}
        onClick={(e) => {
          e.preventDefault()
          if (props.href) window.open(props.href, '_blank')
        }}
        className="text-primary underline-offset-2 hover:underline"
      >
        {props.children}
      </a>
    )
  }
}

export function StreamingMarkdown({ text }: { text: string }) {
  return (
    <div className="text-xs leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components as never}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
