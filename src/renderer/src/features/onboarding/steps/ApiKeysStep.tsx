import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/utils'
import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'
import { isRedactedSecret, isValidOllamaHost, redactedSecretMask } from '@shared/settingsBoundary'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'

type SttOption = 'deepgram' | 'elevenlabs' | 'google' | 'local-whisper'
type FieldShape = 'input' | 'textarea'

interface KeyField {
  i18n: string
  settingsKey: keyof AppSettings
  placeholder: string
  shape?: FieldShape
}

// Map LLM provider → which key/host field to surface in the wizard. Field
// labels and hints come from i18n (`onboarding.keys.llm.<provider>`); the
// placeholder stays here because it's a literal token shape, not localized.
const LLM_FIELD: Record<LlmProvider, KeyField> = {
  'vercel-gateway': { i18n: 'vercel-gateway', settingsKey: 'vercelApiKey', placeholder: 'vck_...' },
  anthropic: { i18n: 'anthropic', settingsKey: 'anthropicApiKey', placeholder: 'sk-ant-...' },
  openai: { i18n: 'openai', settingsKey: 'openaiApiKey', placeholder: 'sk-...' },
  'google-gemini': { i18n: 'google-gemini', settingsKey: 'googleAiApiKey', placeholder: 'AI...' },
  groq: { i18n: 'groq', settingsKey: 'groqApiKey', placeholder: 'gsk_...' },
  ollama: { i18n: 'ollama', settingsKey: 'ollamaHost', placeholder: 'http://127.0.0.1:11434' }
}

// OpenAI's transcription model is being retired, so the wizard doesn't offer it;
// it stays available in Settings.
const STT_OPTIONS: SttOption[] = ['deepgram', 'elevenlabs', 'google', 'local-whisper']

function sttFieldsFor(stt: SttOption): KeyField[] {
  switch (stt) {
    case 'deepgram':
      return [{ i18n: 'deepgram_key', settingsKey: 'deepgramApiKey', placeholder: '' }]
    case 'elevenlabs':
      return [{ i18n: 'elevenlabs_key', settingsKey: 'elevenlabsApiKey', placeholder: 'sk_...' }]
    case 'google':
      return [
        {
          i18n: 'google_project_id',
          settingsKey: 'googleProjectId',
          placeholder: 'my-project-123'
        },
        {
          i18n: 'google_service_account',
          settingsKey: 'googleServiceAccountJson',
          placeholder: '{ "type": "service_account", ... }',
          shape: 'textarea'
        }
      ]
    case 'local-whisper':
      return []
  }
}

export function ApiKeysStep({ settings, update, goNext, goBack }: StepProps) {
  const { t } = useTranslation()
  const provider = settings.llmProvider
  const llmField = LLM_FIELD[provider]

  // STT picker is local until the user advances. Default to whatever the user
  // already has configured, falling back to Deepgram (the recommended path)
  // when they're on a not-yet-supported engine like ElevenLabs.
  const initialStt: SttOption = STT_OPTIONS.includes(settings.sttProvider as SttOption)
    ? (settings.sttProvider as SttOption)
    : 'deepgram'
  const [stt, setStt] = useState<SttOption>(initialStt)
  const sttFields = sttFieldsFor(stt)

  // Seed drafts from settings for every field we might surface — including
  // STT credentials for the engines the user *isn't* on yet — so toggling
  // engines doesn't blow away pre-existing values they've configured before.
  const SEEDED_KEYS: Array<keyof AppSettings> = [
    llmField.settingsKey,
    'deepgramApiKey',
    'elevenlabsApiKey',
    'googleProjectId',
    'googleServiceAccountJson'
  ]
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const k of SEEDED_KEYS) {
      const v = settings[k]
      init[k as string] = typeof v === 'string' ? v : ''
    }
    return init
  })
  const [saving, setSaving] = useState(false)
  const hostInvalid =
    llmField.settingsKey === 'ollamaHost' && !isValidOllamaHost(drafts.ollamaHost ?? '')

  function setDraft(key: keyof AppSettings, value: string): void {
    setDrafts((d) => ({ ...d, [key as string]: value }))
  }

  async function saveAndNext() {
    setSaving(true)
    try {
      // LLM half — write whichever field is active for this provider.
      const llmValue = drafts[llmField.settingsKey] ?? ''
      const llmNext =
        llmField.settingsKey === 'ollamaHost'
          ? llmValue
          : llmValue.trim() === ''
            ? null
            : llmValue.trim()
      await update(llmField.settingsKey, llmNext as never)

      // STT half — switch the engine first, then write only the fields the
      // chosen engine cares about. Other STT credentials are left untouched.
      await update('sttProvider', stt as SttProvider)
      for (const f of sttFields) {
        const v = drafts[f.settingsKey] ?? ''
        const next = v.trim() === '' ? null : v.trim()
        await update(f.settingsKey, next as never)
      }
      goNext()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lead font-medium tracking-tight">{t('onboarding.keys.title')}</h2>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t('onboarding.keys.body')}
        </p>
      </div>

      <KeyRow
        field={llmField}
        labelKey={`onboarding.keys.llm.${llmField.i18n}.label`}
        hintKey={`onboarding.keys.llm.${llmField.i18n}.hint`}
        value={drafts[llmField.settingsKey] ?? ''}
        invalid={hostInvalid}
        onChange={(v) => setDraft(llmField.settingsKey, v)}
      />

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
          {t('onboarding.keys.stt_picker_label')}
        </div>
        <div className="flex flex-col gap-1.5">
          {STT_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setStt(opt)}
              className={cn(
                'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                stt === opt
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent'
              )}
            >
              <div
                className={cn(
                  'mt-1 size-2 shrink-0 rounded-full',
                  stt === opt ? 'bg-primary' : 'bg-muted-foreground/40'
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body">{t(`onboarding.keys.stt_options.${opt}.label`)}</span>
                  {opt === 'deepgram' && (
                    <span className="rounded border border-success/30 bg-success/10 px-1 font-mono text-meta uppercase tracking-wider text-success">
                      {t('onboarding.provider.recommended_badge')}
                    </span>
                  )}
                  {opt === 'local-whisper' && (
                    <span className="rounded border border-border px-1 font-mono text-meta uppercase tracking-wider text-muted-foreground">
                      {t('onboarding.provider.no_key_badge')}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
                  {t(`onboarding.keys.stt_options.${opt}.blurb`)}
                </div>
              </div>
            </button>
          ))}
        </div>

        {sttFields.map((f) => (
          <KeyRow
            key={f.settingsKey as string}
            field={f}
            labelKey={`onboarding.keys.stt_fields.${f.i18n}.label`}
            hintKey={`onboarding.keys.stt_fields.${f.i18n}.hint`}
            value={drafts[f.settingsKey] ?? ''}
            onChange={(v) => setDraft(f.settingsKey, v)}
          />
        ))}

        {stt === 'google' && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
              {t('onboarding.keys.stt_fields.google_setup_help_title')}
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap font-sans text-small leading-relaxed text-muted-foreground">
              {t('onboarding.keys.stt_fields.google_setup_help_body')}
            </pre>
          </div>
        )}

        {stt === 'local-whisper' && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-small leading-relaxed text-muted-foreground">
            {t('onboarding.keys.stt_fields.local_whisper_note')}
          </div>
        )}
      </div>

      <StepFooter>
        <Button variant="ghost" onClick={goBack} disabled={saving}>
          {t('common.back')}
        </Button>
        <Button onClick={() => void saveAndNext()} disabled={saving || hostInvalid}>
          {saving ? t('common.saving') : t('common.next')}
        </Button>
      </StepFooter>
    </div>
  )
}

// Hints name the site to get a key from; make those names clickable.
const SITE = /((?:[a-z0-9-]+\.)+(?:com|dev|io)(?:\/[\w/-]*)?)/gi

function withSiteLinks(text: string): React.ReactNode[] {
  return text.split(SITE).map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={`https://${part}`}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline decoration-white/30 underline-offset-2 hover:decoration-white/70"
      >
        {part}
      </a>
    ) : (
      part
    )
  )
}

function KeyRow({
  field,
  labelKey,
  hintKey,
  value,
  invalid,
  onChange
}: {
  field: KeyField
  labelKey: string
  hintKey: string
  value: string
  invalid?: boolean
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = useId()
  const isTextarea = field.shape === 'textarea'
  const isSecret = !isTextarea && field.settingsKey !== 'ollamaHost'
  // A stored key arrives redacted: show it as configured and let typing
  // replace it. An untouched marker is written back on Next and main drops it.
  const configured = isRedactedSecret(value)
  const shown = configured ? '' : value
  const placeholder = configured
    ? t('settings.providers.key_configured', {
        defaultValue: 'configured · {{mask}}',
        mask: redactedSecretMask(value)
      })
    : field.placeholder
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body text-foreground">
        {t(labelKey)}
      </label>
      {isTextarea ? (
        <Textarea
          id={id}
          value={shown}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[88px] font-mono text-small"
        />
      ) : (
        <Input
          id={id}
          type={isSecret ? 'password' : 'text'}
          value={shown}
          placeholder={placeholder}
          aria-describedby={hintId}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-small"
        />
      )}
      <div id={hintId} className="text-small text-muted-foreground">
        {withSiteLinks(t(hintKey))}
      </div>
    </div>
  )
}
