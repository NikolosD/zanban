import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import type { AppSettings, LlmProvider } from '@shared/types'
import type { StepProps } from '../types'

interface KeyField {
  label: string
  hint: string
  settingsKey: keyof AppSettings
  placeholder: string
}

function fieldsFor(provider: LlmProvider): KeyField[] {
  switch (provider) {
    case 'vercel-gateway':
      return [
        {
          label: 'Vercel AI Gateway key',
          hint: 'Powers the LLM. Get one from vercel.com/ai-gateway.',
          settingsKey: 'vercelApiKey',
          placeholder: 'vck_...'
        }
      ]
    case 'anthropic':
      return [
        {
          label: 'Anthropic API key',
          hint: 'Get one from console.anthropic.com.',
          settingsKey: 'anthropicApiKey',
          placeholder: 'sk-ant-...'
        }
      ]
    case 'openai':
      return [
        {
          label: 'OpenAI API key',
          hint: 'Get one from platform.openai.com.',
          settingsKey: 'openaiApiKey',
          placeholder: 'sk-...'
        }
      ]
    case 'google-gemini':
      return [
        {
          label: 'Google AI key',
          hint: 'Get one from ai.google.dev.',
          settingsKey: 'googleAiApiKey',
          placeholder: 'AI...'
        }
      ]
    case 'groq':
      return [
        {
          label: 'Groq API key',
          hint: 'Get one from console.groq.com.',
          settingsKey: 'groqApiKey',
          placeholder: 'gsk_...'
        }
      ]
    case 'ollama':
      return [
        {
          label: 'Ollama host',
          hint: 'Leave blank to use http://127.0.0.1:11434 (the default).',
          settingsKey: 'ollamaHost',
          placeholder: 'http://127.0.0.1:11434'
        }
      ]
  }
}

const STT_FIELDS: KeyField[] = [
  {
    label: 'Google Cloud project ID',
    hint: 'Required for the default STT (Google Cloud Speech). Auth via gcloud or pasted JSON.',
    settingsKey: 'googleProjectId',
    placeholder: 'my-project-123'
  }
]

export function ApiKeysStep({ settings, update, goNext, goBack }: StepProps) {
  const provider = settings.llmProvider
  const llmFields = fieldsFor(provider)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of [...llmFields, ...STT_FIELDS]) {
      const v = settings[f.settingsKey]
      init[f.settingsKey] = typeof v === 'string' ? v : ''
    }
    return init
  })
  const [saving, setSaving] = useState(false)

  async function saveAndNext() {
    setSaving(true)
    try {
      for (const f of [...llmFields, ...STT_FIELDS]) {
        const v = drafts[f.settingsKey] ?? ''
        // Empty string -> null for nullable string fields. ollamaHost is a
        // non-nullable string so empty stays as empty (= "use default host").
        const next = f.settingsKey === 'ollamaHost' ? v : v.trim() === '' ? null : v.trim()
        await update(f.settingsKey, next as never)
      }
      goNext()
    } finally {
      setSaving(false)
    }
  }

  const localOnly = provider === 'ollama'

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight">Add your keys</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Stored encrypted with your OS keychain. Nothing leaves the machine until you start a
          session.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {llmFields.map((f) => (
          <KeyRow
            key={f.settingsKey as string}
            field={f}
            value={drafts[f.settingsKey] ?? ''}
            onChange={(v) => setDrafts((d) => ({ ...d, [f.settingsKey as string]: v }))}
          />
        ))}
        {!localOnly && (
          <>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              transcription
            </div>
            {STT_FIELDS.map((f) => (
              <KeyRow
                key={f.settingsKey as string}
                field={f}
                value={drafts[f.settingsKey] ?? ''}
                onChange={(v) => setDrafts((d) => ({ ...d, [f.settingsKey as string]: v }))}
              />
            ))}
          </>
        )}
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={goBack} disabled={saving}>
          Back
        </Button>
        <Button onClick={() => void saveAndNext()} disabled={saving}>
          {saving ? 'Saving…' : 'Next'}
        </Button>
      </div>
    </div>
  )
}

function KeyRow({
  field,
  value,
  onChange
}: {
  field: KeyField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] text-foreground">{field.label}</label>
      <Input
        type={field.settingsKey === 'ollamaHost' ? 'text' : 'password'}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-[12px]"
      />
      <div className="text-[11px] text-muted-foreground">{field.hint}</div>
    </div>
  )
}
