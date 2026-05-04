import { Sparkles, X } from 'lucide-react'
import { useQuestions, type DetectedQuestion } from './questionsStore'
import { useAi } from '@renderer/features/ai/store'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

export function DetectedQuestions() {
  const questions = useQuestions((s) => s.questions)
  const pending = questions.filter((q) => q.status === 'pending').slice(-2)

  if (pending.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Detected questions · click to ask AI
      </span>
      <div className="flex flex-wrap gap-1.5">
        {pending.map((q) => (
          <QuestionChip key={q.id} question={q} />
        ))}
      </div>
    </div>
  )
}

function QuestionChip({ question }: { question: DetectedQuestion }) {
  async function answer() {
    useQuestions.getState().markAnswered(question.id)
    try {
      const { requestId } = await window.zanban.ai.ask({ prompt: question.text })
      useAi.getState().newRequest(question.text, requestId)
    } catch (err) {
      const id = `err-${Date.now()}`
      useAi.getState().newRequest(question.text, id)
      useAi.getState().failRequest(id, err instanceof Error ? err.message : 'failed')
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation()
    useQuestions.getState().dismiss(question.id)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={answer}
          className={cn(
            'group inline-flex max-w-[420px] items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5',
            'text-xs transition-colors hover:bg-primary/20 hover:border-primary/60'
          )}
        >
          <Sparkles className="size-3.5 shrink-0 text-primary" />
          <span className="truncate text-left text-foreground">{question.text}</span>
          <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-primary">
            answer ↵
          </span>
          <span
            onClick={dismiss}
            className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            role="button"
          >
            <X className="size-3" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Click to send this question to Gemini and get an answer
      </TooltipContent>
    </Tooltip>
  )
}
