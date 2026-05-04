import { useEffect, useState } from 'react'
import { Eye, EyeOff, Lock, RefreshCw } from 'lucide-react'
import type { AppSettings, SttProvider } from '@shared/types'
import { STT_PROVIDERS } from '@shared/types'
import { Textarea } from '@renderer/components/ui/textarea'
import type { OllamaHealth as OllamaHealthType } from '@shared/api'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}

const LLM_PROVIDERS: Array<{ value: AppSettings['llmProvider']; label: string; hint: string }> = [
  {
    value: 'vercel-gateway',
    label: 'Vercel AI Gateway (default)',
    hint: 'One key, every model — DeepSeek, OpenAI, Gemini, Claude, Mimo. Recommended.'
  },
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'Direct Anthropic API. Best quality on long-context reasoning.'
  },
  {
    value: 'openai',
    label: 'OpenAI',
    hint: 'Direct OpenAI API. GPT-5, GPT-OSS, o-series.'
  },
  {
    value: 'google-gemini',
    label: 'Google Gemini',
    hint: 'Direct Google AI API. Gemini 2.5 / 3.x.'
  },
  {
    value: 'groq',
    label: 'Groq',
    hint: 'Fastest TTFT (sub-100ms). Good for filter / classification.'
  },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    hint: 'Fully local LLM. Requires `ollama serve` running.'
  }
]

export function ProvidersTab({ settings, update }: Props) {
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
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
      // Flip provider settings into the all-local stack in one go.
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
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Privacy Mode
        </h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          One toggle: switches LLM to Ollama (local) and STT to Whisper-tiny (local).
          Nothing leaves your machine. Slower and lower quality than the cloud.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-3">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-emerald-400" />
          <div>
            <div className="text-[13px]">Privacy Mode</div>
            <div className="text-[11px] text-muted-foreground">
              {settings.privacyMode ? 'Active — everything stays local.' : 'Off — using cloud providers.'}
            </div>
          </div>
        </div>
        <Switch checked={settings.privacyMode} onCheckedChange={togglePrivacy} />
      </div>

      <Section title="LLM provider (text + vision)">
        <Select
          value={settings.llmProvider}
          onValueChange={(v) => update('llmProvider', v as AppSettings['llmProvider'])}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {LLM_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {LLM_PROVIDERS.find((p) => p.value === settings.llmProvider)?.hint}
        </p>

        <div className="mt-4 flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Vision provider (image questions)
          </label>
          <Select
            value={settings.visionProvider ?? '__same__'}
            onValueChange={(v) =>
              update(
                'visionProvider',
                v === '__same__' ? null : (v as AppSettings['visionProvider'])
              )
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__same__">Same as text provider</SelectItem>
              {LLM_PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Optional override: route image questions through a different vendor
            (e.g. Vercel for text, Google Gemini for vision). The vision
            provider needs its own key configured below.
          </p>
        </div>

        <ProviderModelsHint provider={settings.llmProvider} />

        {settings.llmProvider === 'vercel-gateway' && (
          <SecretInput
            label="Vercel AI Gateway key"
            value={settings.vercelApiKey ?? ''}
            reveal={reveal.vercel}
            onReveal={(v) => setReveal((s) => ({ ...s, vercel: v }))}
            onChange={(v) => update('vercelApiKey', v || null)}
          />
        )}
        {settings.llmProvider === 'anthropic' && (
          <SecretInput
            label="Anthropic API key"
            value={settings.anthropicApiKey ?? ''}
            reveal={reveal.anthropic}
            onReveal={(v) => setReveal((s) => ({ ...s, anthropic: v }))}
            onChange={(v) => update('anthropicApiKey', v || null)}
          />
        )}
        {settings.llmProvider === 'openai' && (
          <SecretInput
            label="OpenAI API key"
            value={settings.openaiApiKey ?? ''}
            reveal={reveal.openai}
            onReveal={(v) => setReveal((s) => ({ ...s, openai: v }))}
            onChange={(v) => update('openaiApiKey', v || null)}
          />
        )}
        {settings.llmProvider === 'google-gemini' && (
          <SecretInput
            label="Google AI API key"
            value={settings.googleAiApiKey ?? ''}
            reveal={reveal.gemini}
            onReveal={(v) => setReveal((s) => ({ ...s, gemini: v }))}
            onChange={(v) => update('googleAiApiKey', v || null)}
          />
        )}
        {settings.llmProvider === 'groq' && (
          <SecretInput
            label="Groq API key"
            value={settings.groqApiKey ?? ''}
            reveal={reveal.groq}
            onReveal={(v) => setReveal((s) => ({ ...s, groq: v }))}
            onChange={(v) => update('groqApiKey', v || null)}
          />
        )}
        {settings.llmProvider === 'ollama' && (
          <OllamaPanel
            host={settings.ollamaHost}
            onChange={(v) => update('ollamaHost', v)}
            health={ollama}
            onRefresh={() => void refreshOllama()}
          />
        )}
      </Section>

      <Section title="Speech-to-text (STT)">
        <Select
          value={settings.sttProvider}
          onValueChange={(v) => update('sttProvider', v as SttProvider)}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STT_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {STT_PROVIDERS.find((p) => p.value === settings.sttProvider)?.hint}
        </p>

        {settings.sttProvider === 'deepgram' && (
          <SecretInput
            label="Deepgram API key"
            value={settings.deepgramApiKey ?? ''}
            reveal={reveal.deepgram}
            onReveal={(v) => setReveal((s) => ({ ...s, deepgram: v }))}
            onChange={(v) => update('deepgramApiKey', v || null)}
          />
        )}
        {settings.sttProvider === 'google' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Google Cloud project ID</label>
              <Input
                value={settings.googleProjectId ?? ''}
                onChange={(e) => update('googleProjectId', e.target.value || null)}
                placeholder="my-gcp-project-12345"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">
                Service account JSON (optional — leave empty for ADC)
              </label>
              <Textarea
                rows={4}
                value={settings.googleServiceAccountJson ?? ''}
                onChange={(e) =>
                  update('googleServiceAccountJson', e.target.value || null)
                }
                placeholder='{"type":"service_account",…}'
                className="font-mono text-[11px]"
              />
            </div>
          </div>
        )}
        {settings.sttProvider === 'elevenlabs' && (
          <SecretInput
            label="ElevenLabs API key"
            value={settings.elevenlabsApiKey ?? ''}
            reveal={reveal.eleven}
            onReveal={(v) => setReveal((s) => ({ ...s, eleven: v }))}
            onChange={(v) => update('elevenlabsApiKey', v || null)}
          />
        )}
        {settings.sttProvider === 'openai-whisper' && (
          <SecretInput
            label="OpenAI API key"
            value={settings.openaiApiKey ?? ''}
            reveal={reveal.openai}
            onReveal={(v) => setReveal((s) => ({ ...s, openai: v }))}
            onChange={(v) => update('openaiApiKey', v || null)}
          />
        )}
        {settings.sttProvider === 'local-whisper' && (
          <p className="text-[11px] text-muted-foreground">
            On-device — no key needed. Whisper-tiny via @xenova/transformers (~70 MB
            download on first use).
          </p>
        )}
      </Section>

      <Section title="Web search (Tavily)">
        <SecretInput
          label="Tavily API key"
          value={settings.tavilyApiKey ?? ''}
          reveal={reveal.tavily}
          onReveal={(v) => setReveal((s) => ({ ...s, tavily: v }))}
          onChange={(v) => update('tavilyApiKey', v || null)}
        />
        <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <div className="text-[12px]">
            Auto web search
            <div className="text-[11px] text-muted-foreground">
              Inject Tavily results into prompts ≥4 words. Requires the key above.
            </div>
          </div>
          <Switch
            checked={settings.autoWebSearch}
            onCheckedChange={(v) => update('autoWebSearch', v)}
          />
        </div>
      </Section>

    </div>
  )
}

interface OllamaPanelProps {
  host: string
  onChange(v: string): void
  health: OllamaHealthType | null
  onRefresh(): void
}

function OllamaPanel({ host, onChange, health, onRefresh }: OllamaPanelProps) {
  const ok = health?.running
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={host}
          onChange={(e) => onChange(e.target.value)}
          placeholder="http://127.0.0.1:11434 (default)"
          className="flex-1"
        />
        <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh">
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {health && (
        <div
          className={
            ok
              ? 'text-[11px] text-emerald-400'
              : 'text-[11px] text-amber-400'
          }
        >
          {ok
            ? `Connected · ${health.models.length} model${health.models.length === 1 ? '' : 's'} available`
            : `Not reachable · ${health.error ?? 'unknown error'}`}
        </div>
      )}
      {ok && health.models.length > 0 && (
        <div className="font-mono text-[11px] text-muted-foreground">
          {health.models.slice(0, 5).join(' · ')}
          {health.models.length > 5 && ` +${health.models.length - 5} more`}
        </div>
      )}
    </div>
  )
}

interface SecretInputProps {
  label: string
  value: string
  reveal: boolean | undefined
  onReveal(v: boolean): void
  onChange(v: string): void
}

function SecretInput({ label, value, reveal, onReveal, onChange }: SecretInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        <Input
          value={value}
          type={reveal ? 'text' : 'password'}
          onChange={(e) => onChange(e.target.value)}
          placeholder="paste key here…"
          className="flex-1"
        />
        <Button variant="ghost" size="icon" onClick={() => onReveal(!reveal)}>
          {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  )
}

/**
 * Provider-specific copy: where to get the key, which models are interesting,
 * and links to the dev console. Keeps the user from having to guess what to
 * paste in the field above.
 */
function ProviderModelsHint({ provider }: { provider: AppSettings['llmProvider'] }) {
  const info = PROVIDER_INFO[provider]
  if (!info) return null
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.015] px-3 py-2 text-[11px] text-muted-foreground">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {info.title}
        </span>
        <a
          className="text-emerald-400/80 hover:text-emerald-300"
          href={info.consoleUrl}
          target="_blank"
          rel="noreferrer"
        >
          Get a key →
        </a>
      </div>
      <p>{info.description}</p>
      {info.models.length > 0 && (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground/80">
          Common model IDs: {info.models.join(' · ')}
        </div>
      )}
    </div>
  )
}

const PROVIDER_INFO: Record<
  AppSettings['llmProvider'],
  { title: string; description: string; consoleUrl: string; models: string[] }
> = {
  'vercel-gateway': {
    title: 'Vercel AI Gateway',
    description:
      'One key for every cloud model — DeepSeek, OpenAI, Anthropic, Google, Groq. Pay-as-you-go, no per-provider signup. The recommended default.',
    consoleUrl: 'https://vercel.com/dashboard/ai/gateway',
    models: ['openai/gpt-oss-120b', 'anthropic/claude-haiku-4-5', 'deepseek/deepseek-v4']
  },
  anthropic: {
    title: 'Anthropic Claude',
    description:
      'Best long-context reasoning and instruction following. Vision-capable. Set the model ID in the Models tab.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']
  },
  openai: {
    title: 'OpenAI',
    description:
      'GPT family + open-source GPT-OSS. Vision via the same model IDs. For OpenAI streaming STT use the same key under STT below.',
    consoleUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-oss-120b']
  },
  'google-gemini': {
    title: 'Google Gemini',
    description:
      'Gemini 2.5 / 3.x. Strong multimodal (vision + audio). Generous free tier on the AI Studio dashboard.',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview']
  },
  groq: {
    title: 'Groq',
    description:
      'Fastest TTFT in the industry (sub-100ms). Great for the question detector, less so for top-tier reasoning.',
    consoleUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-instruct', 'gemma2-9b-it']
  },
  ollama: {
    title: 'Ollama (local)',
    description:
      'Fully local — your transcripts never leave the machine. Install Ollama, run `ollama serve`, and pull a model with `ollama pull llama3.1:8b`.',
    consoleUrl: 'https://ollama.com/download',
    models: ['llama3.1:8b', 'qwen2.5:7b', 'mistral:7b']
  }
}

// re-export so the parent can show an icon in the sidebar without importing lucide there
export const PROVIDERS_ICON = Lock
