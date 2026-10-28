import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { Persona } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { personaBlurb, personaName } from '@renderer/features/settings/personaLabels'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'

/**
 * "What do you do?" — optional. Picks a built-in role so answers fit the
 * user's calls from the first Ask; skipping leaves the role unset. Role data
 * comes from the seeded built-ins (personas.list()).
 */
export function PersonaStep({ settings, update, goNext, goBack }: StepProps) {
  const { t } = useTranslation()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selected, setSelected] = useState<string | null>(settings.activePersonaId)
  const [saving, setSaving] = useState(false)
  const selectedPersona = personas.find((p) => p.id === selected)
  const selectedName = selectedPersona ? personaName(selectedPersona, t) : undefined

  useEffect(() => {
    void window.zanban.personas.list().then(setPersonas)
  }, [])

  async function saveAndNext() {
    setSaving(true)
    try {
      await update('activePersonaId', selected)
      goNext()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lead font-medium tracking-tight">{t('onboarding.persona.title')}</h2>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-meta uppercase tracking-wider text-muted-foreground">
            {t('onboarding.persona.optional_badge')}
          </span>
        </div>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t('onboarding.persona.body')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {personas.map((p) => {
          const active = selected === p.id
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(active ? null : p.id)}
              className={cn(
                'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
              )}
            >
              <div
                aria-hidden
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  active ? 'bg-primary' : 'bg-muted-foreground/40'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body">{personaName(p, t)}</span>
                  {active && <Check className="size-3.5 text-primary" aria-hidden />}
                </div>
                <div className="mt-0.5 line-clamp-2 text-small leading-relaxed text-muted-foreground">
                  {personaBlurb(p, t)}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <StepFooter>
        <Button variant="ghost" onClick={goBack} disabled={saving}>
          {t('common.back')}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={goNext} disabled={saving}>
            {t('onboarding.persona.skip')}
          </Button>
          <Button onClick={() => void saveAndNext()} disabled={saving || !selected}>
            {saving
              ? t('common.saving')
              : selectedName
                ? t('onboarding.persona.use_role', { name: selectedName })
                : t('onboarding.persona.pick_role')}
          </Button>
        </div>
      </StepFooter>
    </div>
  )
}
