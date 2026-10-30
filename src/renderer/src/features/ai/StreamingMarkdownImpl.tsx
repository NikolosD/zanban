import { memo } from 'react'
import ReactMarkdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/atom-one-dark.css'
import { CodeBlock } from './CodeBlock'
import { inlineCodeClass } from './inlineCode'
import { rehypeCodeLines } from './rehypeCodeLines'
import './streamingMarkdown.css'

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

// Absolute URLs only: relative hrefs like `/C:/...` or `//host/share` would
// resolve against the app origin or a UNC path, so they are dropped.
function safeUrl(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

const components = {
  // react-markdown v9 dropped the `inline` prop, so we detect block code by:
  // 1) a `language-*` or `zb-code` className (rehypeCodeLines marks every fenced block), or
  // 2) the content containing a newline. Otherwise it's inline.
  code(props: { className?: string; children?: React.ReactNode }) {
    const { className, children } = props
    const hasLang = /(^|\s)(language|zb-code)(-|\s|$)/.test(className ?? '')
    const isMultiline = typeof children === 'string' && children.includes('\n')
    if (hasLang || isMultiline) {
      return (
        <code
          className={`hljs block whitespace-pre overflow-x-auto rounded-lg p-3 text-[13px] leading-[1.5] font-mono ${className ?? ''}`}
        >
          {children}
        </code>
      )
    }
    return <code className={inlineCodeClass(children)}>{children}</code>
  },
  pre(props: { children?: React.ReactNode }) {
    // The language tag comes from the inner <code>'s className, if any.
    const child = Array.isArray(props.children) ? props.children[0] : props.children
    const cls = (child as { props?: { className?: string } } | undefined)?.props?.className ?? ''
    const langMatch = cls.match(/language-([\w-]+)/)
    return <CodeBlock lang={langMatch?.[1]}>{props.children}</CodeBlock>
  },
  ul(props: { children?: React.ReactNode }) {
    return <ul className="my-1 list-disc pl-4">{props.children}</ul>
  },
  ol(props: { children?: React.ReactNode }) {
    return <ol className="my-1 list-decimal pl-4">{props.children}</ol>
  },
  p(props: { children?: React.ReactNode }) {
    return <p className="my-1">{props.children}</p>
  },
  h1(props: { children?: React.ReactNode }) {
    return (
      <h1 className="mb-1 mt-4 text-[1.2em] font-semibold text-foreground first:mt-0">
        {props.children}
      </h1>
    )
  },
  h2(props: { children?: React.ReactNode }) {
    return (
      <h2 className="mb-1 mt-4 text-[1.1em] font-semibold text-foreground first:mt-0">
        {props.children}
      </h2>
    )
  },
  h3(props: { children?: React.ReactNode }) {
    return (
      <h3 className="mb-0.5 mt-3 text-[1.1em] font-semibold text-foreground first:mt-0">
        {props.children}
      </h3>
    )
  },
  table(props: { children?: React.ReactNode }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">{props.children}</table>
      </div>
    )
  },
  th(props: { style?: React.CSSProperties; children?: React.ReactNode }) {
    return (
      <th
        style={props.style}
        className="border border-white/15 bg-white/[0.04] px-2 py-1 font-semibold"
      >
        {props.children}
      </th>
    )
  },
  td(props: { style?: React.CSSProperties; children?: React.ReactNode }) {
    return (
      <td style={props.style} className="border border-white/15 px-2 py-1 align-top">
        {props.children}
      </td>
    )
  },
  // Never fetch images from model output: a prompt-injected answer could
  // smuggle transcript text out in an image URL the moment it renders.
  img(props: { alt?: string }) {
    return props.alt ? <span className="text-muted-foreground">{props.alt}</span> : null
  },
  a(props: { href?: string; children?: React.ReactNode }) {
    const safeHref = safeUrl(props.href) ?? undefined
    return (
      <a
        href={safeHref}
        onClick={(e) => {
          e.preventDefault()
          if (safeHref) void window.zanban.openExternal(safeHref)
        }}
        className="text-primary underline-offset-2 hover:underline"
      >
        {props.children}
      </a>
    )
  }
}

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm]
// Re-highlighting every code block on each streamed chunk is the costliest part
// of a render, so highlighting is applied once, when the answer is complete.
const HIGHLIGHT_PLUGINS: Options['rehypePlugins'] = [
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
  rehypeCodeLines
]
const NO_PLUGINS: Options['rehypePlugins'] = [rehypeCodeLines]

function StreamingMarkdownImpl({ text, highlight }: { text: string; highlight: boolean }) {
  return (
    // --md-text lets a host enlarge one answer (the overlay's newest) without a prop.
    // --md-body-alpha dims body copy; headings and inline code keep full contrast.
    <div className="min-w-0 text-[length:var(--md-text,13px)] leading-[1.5] [color:color-mix(in_oklab,var(--foreground)_var(--md-body-alpha,100%),transparent)] break-words">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={highlight ? HIGHLIGHT_PLUGINS : NO_PLUGINS}
        components={components as never}
        urlTransform={safeUrl}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(StreamingMarkdownImpl)
