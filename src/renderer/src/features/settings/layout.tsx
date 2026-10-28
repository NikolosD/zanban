import { useId } from 'react'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
}

/** Monospace eyebrow + hint, then the rows. Wide bottom margin keeps adjacent groups apart. */
export function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10 first:mt-0">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="font-mono text-meta uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
        {hint && <p className="text-small leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

/** Label + hint column beside a control; spread `control` onto the control. */
export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children(control: FieldControlProps): React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <div className="pt-1.5">
        <label htmlFor={id} className="block text-body text-foreground/85">
          {label}
        </label>
        {hint && (
          <div id={hintId} className="mt-0.5 text-small text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="min-w-0">
        {children({ id, 'aria-describedby': hint ? hintId : undefined })}
      </div>
    </div>
  )
}

/** Whole-row label around a switch, so a click anywhere on the row flips it. */
export function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-white/[0.05] bg-white/[0.015] px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
      <div className="min-w-0">
        <div className="text-body text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-small text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </label>
  )
}

/** Inline text button that jumps to another settings tab. */
export function TabLink({ onClick, children }: { onClick(): void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {children}
    </button>
  )
}
