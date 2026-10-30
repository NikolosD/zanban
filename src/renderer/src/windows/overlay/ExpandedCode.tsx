import { Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CodeBlock, CodeBlockContext, type ExpandedCode } from '@renderer/features/ai/CodeBlock'

const NO_OPTIONS = {}

/** One code block filling the overlay. Its text never starts a window drag. */
export function ExpandedCodeView({
  block,
  scrollRef,
  onCollapse
}: {
  block: ExpandedCode
  scrollRef: React.Ref<HTMLDivElement>
  onCollapse: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-2 pt-1.5">
        <button
          type="button"
          data-interactive
          onClick={onCollapse}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.08] px-2 py-0.5 font-mono text-small text-foreground/80 transition-colors hover:bg-white/[0.14] hover:text-foreground"
        >
          <Minimize2 className="size-3" aria-hidden />
          {t('overlay.code.collapse')}
          <span className="text-muted-foreground">Esc</span>
        </button>
      </div>
      <div
        ref={scrollRef}
        data-interactive
        data-no-drag
        className="min-h-0 flex-1 cursor-auto overflow-y-auto overflow-x-hidden px-2 pb-2"
      >
        <CodeBlockContext.Provider value={NO_OPTIONS}>
          <CodeBlock lang={block.lang} large>
            {block.code}
          </CodeBlock>
        </CodeBlockContext.Provider>
      </div>
    </div>
  )
}
