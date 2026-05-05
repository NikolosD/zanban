import { useEffect, useState } from 'react'
import { Lock, RefreshCw } from 'lucide-react'
import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'
import { Textarea } from '@renderer/components/ui/textarea'
import type { OllamaHealth as OllamaHealthType } from '@shared/api'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { ProviderCard, SecretKeyField } from './ProviderCard'
import { cn } from '@renderer/lib/utils'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}

interface LlmProviderEntry {
  value: LlmProvider
  name: string
  description: string
  badge: 'recommended' | 'experimental' | 'local' | null
  keyUrl?: string
}

export const LLM_PROVIDERS: LlmProviderEntry[] = [
  {
    value: 'vercel-gateway',
    name: 'Vercel AI Gateway',
    description:
      'One key, every model — DeepSeek, OpenAI, Anthropic, Google, Groq. Pay-as-you-go.',
    badge: 'recommended',
    keyUrl: 'https://vercel.com/dashboard/ai/gateway'
  },
  {
    value: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Direct Anthropic API. Best long-context reasoning.',
    badge: null,
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    value: 'openai',
    name: 'OpenAI',
    description: 'GPT-5, GPT-OSS, o-series. Vision via the same model IDs.',
    badge: null,
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    value: 'google-gemini',
    name: 'Google Gemini',
    description: 'Gemini 2.5 / 3.x. Strong multimodal. Generous free tier.',
    badge: null,
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    value: 'groq',
    name: 'Groq',
    description: 'Fastest TTFT (sub-100ms). Great for question detector.',
    badge: null,
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    value: 'ollama',
    name: 'Ollama (local)',
    description: 'Fully local — your transcripts never leave the machine.',
    badge: 'local',
    keyUrl: 'https://ollama.com/download'
  }
]

interface SttProviderEntry {
  value: SttProvider
  name: string
  description: string
  badge: 'recommended' | 'experimental' | 'local' | null
  keyUrl?: string
}

const STT_CARDS: SttProviderEntry[] = [
  {
    value: 'deepgram',
    name: 'Deepgram Nova-3',
    description: 'High-accuracy streaming. Single API key, low latency.',
    badge: 'recommended',
    keyUrl: 'https://console.deepgram.com/'
  },
  {
    value: 'google',
    name: 'Google Cloud Speech-to-Text',
    description: 'Chirp 3 multilingual streaming. Needs a GCP project + ADC or service account.',
    badge: 'recommended',
    keyUrl: 'https://console.cloud.google.com/apis/credentials'
  },
  {
    value: 'openai-whisper',
    name: 'OpenAI Whisper',
    description: 'Whisper-large via OpenAI Realtime / batch API. Wire-up pending.',
    badge: 'experimental',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    value: 'elevenlabs',
    name: 'ElevenLabs Scribe',
    description: 'Scribe v2 Realtime API. Wire-up pending.',
    badge: 'experimental',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys'
  },
  {
    value: 'local-whisper',
    name: 'Local Whisper',
    description: 'On-device — no key needed. Whisper-tiny via @xenova/transformers.',
    badge: 'local'
  }
]

/**
 * AI providers tab body — LLM cards only. STT lives in the Audio tab,
 * Tavily lives in its own section below the model overrides.
 */
export function ProvidersTab({ settings, update }: Props) {
  const [ollama, setOllama] = useState<OllamaHealthType | null>(null)

  async function refreshOllama() {
    const h = (await window.zanban.ollama.health()) as OllamaHealthType
    setOllama(h)
  }

  useEffect(() => {
    void refreshOllama()
  }, [settings.ollamaHost])

  const togglePrivacy = (v: boolean) => {
    if (v) {
      update('privacyMode', true)
      update('llmProvider', 'ollama')
      update('sttProvider', 'local-whisper')
    } else {
      update('privacyMode', false)
      update('llmProvider', 'vercel-gateway')
      update('sttProvider', 'deepgram')
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Privacy mode — single switch that flips both LLM + STT to local. Sits
          at the top because it overrides the provider selection below. */}
      <PrivacyModeRow
        active={settings.privacyMode}
        onToggle={togglePrivacy}
      />

      {/* LLM provider cards */}
      <div className="flex flex-col gap-3">
        <SectionHead
          title="ai providers · text & vision"
          hint="Pick which provider answers your questions. Click a card to make it active — credentials stay in the OS keychain."
        />

        <div className="flex flex-col gap-2.5">
          {LLM_PROVIDERS.map((p) => {
            const active = settings.llmProvider === p.value
            return (
              <ProviderCard
                key={p.value}
                id={p.value}
                name={p.name}
                description={p.description}
                badge={p.badge}
                keyUrl={p.keyUrl}
                active={active}
                onActivate={() => update('llmProvider', p.value)}
              >
                {active && (
                  <LlmCredentials
                    provider={p.value}
                    settings={settings}
                    update={update}
                    ollama={ollama}
                    onRefreshOllama={() => void refreshOllama()}
                  />
                )}
              </ProviderCard>
            )
          })}
        </div>

      </div>
    </div>
  )
}

/**
 * STT provider cards — exported so AudioTab can render them next to the
 * mic / VAD / language settings (their natural sibling group).
 */
export function SttProviderCards({ settings, update }: Props) {
  return (
    <div className="flex flex-col gap-2.5">
      {STT_CARDS.map((p) => {
        const active = settings.sttProvider === p.value
        return (
          <ProviderCard
            key={p.value}
            id={p.value}
            name={p.name}
            description={p.description}
            badge={p.badge}
            keyUrl={p.keyUrl}
            active={active}
            onActivate={() => update('sttProvider', p.value)}
          >
            {active && (
              <SttCredentials
                provider={p.value}
                settings={settings}
                update={update}
              />
            )}
          </ProviderCard>
        )
      })}
    </div>
  )
}

/**
 * Tavily web-search section — exported so it can render at the very bottom
 * of the AI tab, after model overrides.
 */
export function WebSearchCard({ settings, update }: Props) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">Tavily Search API</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Powers live web search for company research. If empty, LLM general
            knowledge is used and may be outdated.
          </p>
        </div>
        <a
          href="https://tavily.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-white/[0.14] hover:text-foreground"
        >
          get key
        </a>
      </div>
      <SecretKeyField
        placeholder="tvly-…"
        value={settings.tavilyApiKey ?? ''}
        onChange={(v) => update('tavilyApiKey', v || null)}
      />
      <div className="mt-3 flex items-center justify-between rounded-md border border-white/[0.04] bg-white/[0.015] px-3 py-2">
        <div className="text-[12px]">
          Auto web search
          <div className="text-[11px] text-muted-foreground">
            Inject Tavily results into prompts ≥4 words.
          </div>
        </div>
        <Switch
          checked={settings.autoWebSearch}
          onCheckedChange={(v) => update('autoWebSearch', v)}
        />
      </div>
    </div>
  )
}

// — — — small atoms reused inside this tab — — —

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {hint && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function PrivacyModeRow({
  active,
  onToggle
}: {
  active: boolean
  onToggle(v: boolean): void
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors',
        active
          ? 'border-accent/40 bg-accent/[0.06]'
          : 'border-white/[0.06] bg-white/[0.02]'
      )}
    >
      <div className="flex items-center gap-3">
        <Lock
          className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-muted-foreground')}
        />
        <div>
          <div className="text-[13px] font-medium">Privacy mode</div>
          <div className="text-[11px] text-muted-foreground">
            {active
              ? 'Active — LLM is Ollama, STT is local Whisper. Nothing leaves your machine.'
              : 'Off — flips LLM + STT to local at once. Slower, lower quality, fully private.'}
          </div>
        </div>
      </div>
      <Switch checked={active} onCheckedChange={onToggle} />
    </div>
  )
}

// — — — credential bodies — — —

/**
 * Per-provider key-bearing settings field. Providers that share this shape
 * (everything except ollama, which has its own host+health-check UI) only
 * differ by which AppSettings field stores the key, the label, and the
 * placeholder hint.
 */
const LLM_KEY_FIELDS: Partial<
  Record<
    LlmProvider,
    {
      label: string
      placeholder?: string
      settingsKey: keyof Pick<
        AppSettings,
        'vercelApiKey' | 'anthropicApiKey' | 'openaiApiKey' | 'googleAiApiKey' | 'groqApiKey'
      >
    }
  >
> = {
  'vercel-gateway': { label: 'Vercel AI Gateway key', placeholder: 'vck_…', settingsKey: 'vercelApiKey' },
  anthropic: { label: 'Anthropic API key', placeholder: 'sk-ant-…', settingsKey: 'anthropicApiKey' },
  openai: { label: 'OpenAI API key', placeholder: 'sk-…', settingsKey: 'openaiApiKey' },
  'google-gemini': { label: 'Google AI API key', placeholder: 'AIza…', settingsKey: 'googleAiApiKey' },
  groq: { label: 'Groq API key', placeholder: 'gsk_…', settingsKey: 'groqApiKey' }
}

function LlmCredentials({
  provider,
  settings,
  update,
  ollama,
  onRefreshOllama
}: {
  provider: LlmProvider
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  ollama: OllamaHealthType | null
  onRefreshOllama(): void
}) {
  const field = LLM_KEY_FIELDS[provider]
  if (field) {
    return (
      <SecretKeyField
        label={field.label}
        placeholder={field.placeholder}
        value={settings[field.settingsKey] ?? ''}
        onChange={(v) => update(field.settingsKey, v || null)}
      />
    )
  }
  if (provider === 'ollama') {
    const ok = ollama?.running
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Input
            value={settings.ollamaHost}
            onChange={(e) => update('ollamaHost', e.target.value)}
            placeholder="http://127.0.0.1:11434 (default)"
            className="flex-1 font-mono text-xs"
          />
          <Button variant="ghost" size="icon" onClick={onRefreshOllama} aria-label="Refresh">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {ollama && (
          <div className={ok ? 'text-[11px] text-accent' : 'text-[11px] text-amber-400'}>
            {ok
              ? `connected · ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}`
              : `not reachable · ${ollama.error ?? 'unknown error'}`}
          </div>
        )}
        {ok && ollama.models.length > 0 && (
          <div className="font-mono text-[11px] text-muted-foreground">
            {ollama.models.slice(0, 5).join(' · ')}
            {ollama.models.length > 5 && ` +${ollama.models.length - 5} more`}
          </div>
        )}
      </div>
    )
  }
  return null
}

const STT_KEY_FIELDS: Partial<
  Record<
    SttProvider,
    {
      label: string
      settingsKey: keyof Pick<
        AppSettings,
        'deepgramApiKey' | 'openaiApiKey' | 'elevenlabsApiKey'
      >
    }
  >
> = {
  deepgram: { label: 'Deepgram API key', settingsKey: 'deepgramApiKey' },
  'openai-whisper': { label: 'OpenAI API key', settingsKey: 'openaiApiKey' },
  elevenlabs: { label: 'ElevenLabs API key', settingsKey: 'elevenlabsApiKey' }
}

function SttCredentials({
  provider,
  settings,
  update
}: {
  provider: SttProvider
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const field = STT_KEY_FIELDS[provider]
  if (field) {
    return (
      <SecretKeyField
        label={field.label}
        value={settings[field.settingsKey] ?? ''}
        onChange={(v) => update(field.settingsKey, v || null)}
      />
    )
  }
  if (provider === 'google') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Google Cloud project ID
          </label>
          <Input
            value={settings.googleProjectId ?? ''}
            onChange={(e) => update('googleProjectId', e.target.value || null)}
            placeholder="my-gcp-project-12345"
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Service account JSON{' '}
            <span className="normal-case tracking-normal text-muted-foreground/60">
              (optional — leave empty for ADC)
            </span>
          </label>
          <Textarea
            rows={4}
            value={settings.googleServiceAccountJson ?? ''}
            onChange={(e) => update('googleServiceAccountJson', e.target.value || null)}
            placeholder='{"type":"service_account",…}'
            className="font-mono text-[11px]"
          />
        </div>
      </div>
    )
  }
  if (provider === 'local-whisper') {
    return (
      <p className="text-[11px] text-muted-foreground">
        On-device — no key needed. Whisper-tiny via @xenova/transformers (~70 MB
        on first use).
      </p>
    )
  }
  return null
}
