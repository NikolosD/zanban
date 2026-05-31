import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import type { Persona, ResponseLanguage } from '@shared/types'
import { RESPONSE_LANGUAGES } from '@shared/types'
import type { StepProps } from '../types'

/**
 * "What do you do?" — picks an assistant persona (built-in role) plus the
 * response language so the assistant is useful from the first Ask. Fully
 * skippable: leaving the persona unset keeps the free-form default. Persona
 * data comes from the seeded built-ins (personas.list()).
 */
export function PersonaStep({ settings, update, goNext, goBack }: StepProps) {
  const { t } = useTranslation()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selected, setSelected] = useState<string | null>(settings.activePersonaId)
  const [language, setLanguage] = useState<ResponseLanguage>(settings.responseLanguage)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.zanban.personas.list().then(setPersonas)
  }, [])

  async function saveAndNext() {
    setSaving(true)
    try {
      await update('activePersonaId', selected)
      await update('responseLanguage', language)
      goNext()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">{t('onboarding.persona.title')}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('onboarding.persona.body')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {personas.map((p) => {
          const active = selected === p.id
          return (
            <button
              key={p.id}
              onClick={() => setSelected(active ? null : p.id)}
              className={cn(
                'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
              )}
            >
              <div
                className={cn(
                  'mt-1 size-2 shrink-0 rounded-full',
                  active ? 'bg-primary' : 'bg-muted-foreground/40'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{p.name}</span>
                  {active && <Check className="size-3.5 text-primary" />}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {p.systemPrompt}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('onboarding.persona.language_label')}
        </div>
        <Select value={language} onValueChange={(v) => setLanguage(v as ResponseLanguage)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSE_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack} disabled={saving}>
          {t('common.back')}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={goNext} disabled={saving}>
            {t('onboarding.persona.skip')}
          </Button>
          <Button onClick={() => void saveAndNext()} disabled={saving}>
            {saving ? t('common.saving') : t('common.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
