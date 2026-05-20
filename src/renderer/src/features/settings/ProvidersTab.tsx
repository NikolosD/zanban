import { useEffect, useState } from 'react'
import { Lock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'
import { Textarea } from '@renderer/components/ui/textarea'
import type { OllamaHealth as OllamaHealthType } from '@shared/api'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { ProviderCard, SecretKeyField } from './ProviderCard'
import { LlmFallbackOrderField } from './LlmFallbackOrderField'
import { llmProviderStatus } from './providerStatus'
import { cn } from '@renderer/lib/utils'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}

// Display strings (name + description + per-key labels) live in i18n —
// `settings.providers.llm.<id>` / `settings.providers.stt.<id>`. The entries
// below only carry the stable, language-agnostic data: id, badge, link to the
// provider's API console.
interface LlmProviderEntry {
  value: LlmProvider
  badge: 'recommended' | 'experimental' | 'local' | null
  keyUrl?: string
}

export const LLM_PROVIDERS: LlmProviderEntry[] = [
  {
    value: 'vercel-gateway',
    badge: 'recommended',
    keyUrl: 'https://vercel.com/dashboard/ai/gateway'
  },
  { value: 'anthropic', badge: null, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { value: 'openai', badge: null, keyUrl: 'https://platform.openai.com/api-keys' },
  { value: 'google-gemini', badge: null, keyUrl: 'https://aistudio.google.com/app/apikey' },
  { value: 'groq', badge: null, keyUrl: 'https://console.groq.com/keys' },
  { value: 'ollama', badge: 'local', keyUrl: 'https://ollama.com/download' }
]

interface SttProviderEntry {
  value: SttProvider
  badge: 'recommended' | 'experimental' | 'local' | null
  keyUrl?: string
}

const STT_CARDS: SttProviderEntry[] = [
  { value: 'deepgram', badge: 'recommended', keyUrl: 'https://console.deepgram.com/' },
  {
    value: 'google',
    badge: 'recommended',
    keyUrl: 'https://console.cloud.google.com/apis/credentials'
  },
  { value: 'openai-whisper', badge: null, keyUrl: 'https://platform.openai.com/api-keys' },
  { value: 'elevenlabs', badge: null, keyUrl: 'https://elevenlabs.io/app/settings/api-keys' },
  { value: 'local-whisper', badge: 'local' }
]

/**
 * AI providers tab body — LLM cards only. STT lives in the Audio tab,
 * Tavily lives in its own section below the model overrides.
 */
export function ProvidersTab({ settings, update }: Props) {
  const { t } = useTranslation()
  const [ollama, setOllama] = useState<OllamaHealthType | null>(null)

  async function refreshOllama() {
    const h = (await window.zanban.ollama.health()) as OllamaHealthType
    setOllama(h)
  }

  // Debounce the health-check so a user typing the host URL doesn't hammer
  // localhost on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      void refreshOllama()
    }, 400)
    return () => clearTimeout(handle)
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
      <PrivacyModeRow active={settings.privacyMode} onToggle={togglePrivacy} />

      {/* LLM provider cards */}
      <div className="flex flex-col gap-3">
        <SectionHead
          title={t('settings.providers.ai_section_title')}
          hint={t('settings.providers.ai_section_hint')}
        />

        <div className="flex flex-col gap-2.5">
          {LLM_PROVIDERS.map((p) => {
            const active = settings.llmProvider === p.value
            const status = llmProviderStatus(p.value, settings, ollama)
            return (
              <ProviderCard
                key={p.value}
                id={p.value}
                name={t(`settings.providers.llm.${p.value}.name`)}
                description={t(`settings.providers.llm.${p.value}.description`)}
                badge={p.badge}
                status={status}
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

        <LlmFallbackOrderField settings={settings} update={update} />
      </div>
    </div>
  )
}

/**
 * STT provider cards — exported so AudioTab can render them next to the
 * mic / VAD / language settings (their natural sibling group).
 */
export function SttProviderCards({ settings, update }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2.5">
      {STT_CARDS.map((p) => {
        const active = settings.sttProvider === p.value
        return (
          <ProviderCard
            key={p.value}
            id={p.value}
            name={t(`settings.providers.stt.${p.value}.name`)}
            description={t(`settings.providers.stt.${p.value}.description`)}
            badge={p.badge}
            keyUrl={p.keyUrl}
            active={active}
            onActivate={() => update('sttProvider', p.value)}
          >
            {active && <SttCredentials provider={p.value} settings={settings} update={update} />}
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
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">{t('settings.providers.tavily_title')}</div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('settings.providers.tavily_hint')}
          </p>
        </div>
        <a
          href="https://tavily.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-white/[0.14] hover:text-foreground"
        >
          {t('settings.providers.get_key')}
        </a>
      </div>
      <SecretKeyField
        placeholder={t('settings.providers.tavily_placeholder')}
        value={settings.tavilyApiKey ?? ''}
        onChange={(v) => update('tavilyApiKey', v || null)}
      />
      <div className="mt-3 flex items-center justify-between rounded-md border border-white/[0.04] bg-white/[0.015] px-3 py-2">
        <div className="text-[12px]">
          {t('settings.providers.tavily_auto_label')}
          <div className="text-[11px] text-muted-foreground">
            {t('settings.providers.tavily_auto_hint')}
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
      {hint && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

function PrivacyModeRow({ active, onToggle }: { active: boolean; onToggle(v: boolean): void }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors',
        active ? 'border-accent/40 bg-accent/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
      )}
    >
      <div className="flex items-center gap-3">
        <Lock className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-muted-foreground')} />
        <div>
          <div className="text-[13px] font-medium">
            {t('settings.providers.privacy_mode_label')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {active
              ? t('settings.providers.privacy_mode_on')
              : t('settings.providers.privacy_mode_off')}
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
// Map LLM provider → which AppSettings field stores the key and the placeholder
// hint shown in the input. Display label comes from i18n
// (`settings.providers.llm.<id>.key_label`).
const LLM_KEY_FIELDS: Partial<
  Record<
    LlmProvider,
    {
      placeholder?: string
      settingsKey: keyof Pick<
        AppSettings,
        'vercelApiKey' | 'anthropicApiKey' | 'openaiApiKey' | 'googleAiApiKey' | 'groqApiKey'
      >
    }
  >
> = {
  'vercel-gateway': { placeholder: 'vck_…', settingsKey: 'vercelApiKey' },
  anthropic: { placeholder: 'sk-ant-…', settingsKey: 'anthropicApiKey' },
  openai: { placeholder: 'sk-…', settingsKey: 'openaiApiKey' },
  'google-gemini': { placeholder: 'AIza…', settingsKey: 'googleAiApiKey' },
  groq: { placeholder: 'gsk_…', settingsKey: 'groqApiKey' }
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
  const { t } = useTranslation()
  const field = LLM_KEY_FIELDS[provider]
  if (field) {
    return (
      <SecretKeyField
        label={t(`settings.providers.llm.${provider}.key_label`)}
        placeholder={field.placeholder}
        value={settings[field.settingsKey] ?? ''}
        onChange={(v) => update(field.settingsKey, v || null)}
      />
    )
  }
  if (provider === 'ollama') {
    const ok = ollama?.running
    const modelCount = ollama?.models.length ?? 0
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Input
            value={settings.ollamaHost}
            onChange={(e) => update('ollamaHost', e.target.value)}
            placeholder={t('settings.providers.ollama_host_placeholder')}
            className="flex-1 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefreshOllama}
            aria-label={t('settings.providers.ollama_refresh_aria')}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {ollama && (
          <div className={ok ? 'text-[11px] text-accent' : 'text-[11px] text-amber-400'}>
            {ok
              ? t(
                  modelCount === 1
                    ? 'settings.providers.ollama_connected_one'
                    : 'settings.providers.ollama_connected_other',
                  { count: modelCount }
                )
              : t('settings.providers.ollama_not_reachable', {
                  error: ollama.error ?? t('settings.providers.ollama_unknown_error')
                })}
          </div>
        )}
        {ok && ollama.models.length > 0 && (
          <div className="font-mono text-[11px] text-muted-foreground">
            {ollama.models.slice(0, 5).join(' · ')}
            {ollama.models.length > 5 &&
              t('settings.providers.ollama_more_models', { count: ollama.models.length - 5 })}
          </div>
        )}
      </div>
    )
  }
  return null
}

// Map STT provider → which AppSettings field stores the key. Display label
// comes from i18n (`settings.providers.stt.<id>.key_label`).
const STT_KEY_FIELDS: Partial<
  Record<
    SttProvider,
    {
      settingsKey: keyof Pick<AppSettings, 'deepgramApiKey' | 'openaiApiKey' | 'elevenlabsApiKey'>
    }
  >
> = {
  deepgram: { settingsKey: 'deepgramApiKey' },
  'openai-whisper': { settingsKey: 'openaiApiKey' },
  elevenlabs: { settingsKey: 'elevenlabsApiKey' }
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
  const { t } = useTranslation()
  const field = STT_KEY_FIELDS[provider]
  if (field) {
    return (
      <SecretKeyField
        label={t(`settings.providers.stt.${provider}.key_label`)}
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
            {t('settings.providers.google_project_id_label')}
          </label>
          <Input
            value={settings.googleProjectId ?? ''}
            onChange={(e) => update('googleProjectId', e.target.value || null)}
            placeholder={t('settings.providers.google_project_id_placeholder')}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('settings.providers.google_service_account_label')}{' '}
            <span className="normal-case tracking-normal text-muted-foreground/60">
              {t('settings.providers.google_service_account_optional')}
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
        {t('settings.providers.local_whisper_note')}
      </p>
    )
  }
  return null
}
