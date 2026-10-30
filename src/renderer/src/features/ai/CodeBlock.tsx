import { Children, createContext, isValidElement, useContext, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface ExpandedCode {
  lang: string | undefined
  code: React.ReactNode
}

export interface CodeBlockOptions {
  onExpand?: (block: ExpandedCode) => void
}

/**
 * Without a provider a code block keeps its plain look: one scrolling line per
 * source line. A host that provides options (the overlay) gets numbered lines
 * that wrap with a hanging indent, a wrap toggle and, with `onExpand`, a
 * button that hands the block over to be shown larger.
 */
export const CodeBlockContext = createContext<CodeBlockOptions | null>(null)

const BUTTON_CLASS =
  'rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.1] hover:text-foreground'

function lineCount(code: React.ReactNode): number {
  return isValidElement<{ children?: React.ReactNode }>(code)
    ? Children.count(code.props.children)
    : 1
}

export function CodeBlock({
  lang,
  large = false,
  children
}: {
  lang: string | undefined
  large?: boolean
  children: React.ReactNode
}) {
  const options = useContext(CodeBlockContext)
  const { t } = useTranslation()
  const [wrap, setWrap] = useState(true)

  if (!options) {
    return (
      <div className="zb-codeblock relative my-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]">
        {lang && (
          <div className="zb-lang pointer-events-none absolute right-2 top-1.5 select-none rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-small">
            {lang}
          </div>
        )}
        <pre className="m-0 overflow-x-auto bg-transparent p-0">{children}</pre>
      </div>
    )
  }

  const gutter = `${String(lineCount(children)).length + 1}ch`
  return (
    <div
      data-numbered="true"
      data-wrap={wrap}
      data-large={large}
      style={{ '--zb-gutter': gutter } as React.CSSProperties}
      className="zb-codeblock relative my-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-2 py-0.5 font-mono text-small">
        <span className="zb-lang select-none">{lang}</span>
        <span className="flex items-center gap-0.5 select-none">
          <button type="button" className={BUTTON_CLASS} onClick={() => setWrap((w) => !w)}>
            {wrap ? t('overlay.code.no_wrap') : t('overlay.code.wrap')}
          </button>
          {options.onExpand && (
            <button
              type="button"
              data-code-expand
              className={`${BUTTON_CLASS} inline-flex items-center gap-1`}
              onClick={() => options.onExpand?.({ lang, code: children })}
            >
              <Maximize2 className="size-3" aria-hidden />
              {t('overlay.code.expand')}
            </button>
          )}
        </span>
      </div>
      <pre className="m-0 overflow-x-auto bg-transparent p-0">{children}</pre>
    </div>
  )
}
