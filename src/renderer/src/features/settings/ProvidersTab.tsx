import { useEffect, useState } from 'react'
import {
  Lock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Plug,
  Download,
  AlertTriangle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, LlmProvider, SttProvider } from '@shared/types'
import { PROVIDER_FAST_MODELS } from '@shared/types'
import { Textarea } from '@renderer/components/ui/textarea'
import type { OllamaHealth as OllamaHealthType, ProviderTestResult } from '@shared/api'
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
      // Snapshot the current (custom) provider picks so disabling Privacy Mode
      // restores them rather than clobbering with the cloud defaults.
      update('privacyModeSnapshot', {
        llmProvider: settings.llmProvider,
        sttProvider: settings.sttProvider
      })
      update('privacyMode', true)
      update('llmProvider', 'ollama')
      update('sttProvider', 'local-whisper')
    } else {
      update('privacyMode', false)
      // Restore the pre-privacy picks when we have a snapshot; otherwise fall
      // back to the cloud defaults (fresh install / never toggled before).
      const snap = settings.privacyModeSnapshot
      update('llmProvider', snap?.llmProvider ?? 'vercel-gateway')
      update('sttProvider', snap?.sttProvider ?? 'deepgram')
      update('privacyModeSnapshot', null)
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

/**
 * Real "Test connection" affordance. Runs a cheap live probe through the
 * provider abstraction (`providers.testConnection`) and reports verified /
 * failed with the provider's own error text — distinct from the
 * config-presence dot, which only knows whether a key string is set.
 */
function ProviderTestButton({ provider, disabled }: { provider: LlmProvider; disabled?: boolean }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'testing'>('idle')
  const [result, setResult] = useState<ProviderTestResult | null>(null)

  async function run() {
    setState('testing')
    setResult(null)
    try {
      const res = await window.zanban.providers.testConnection(provider)
      setResult(res)
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setState('idle')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-[11px]"
        disabled={disabled || state === 'testing'}
        onClick={() => void run()}
      >
        {state === 'testing' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Plug className="size-3" />
        )}
        {t('settings.providers.test_connection')}
      </Button>
      {result && (
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 text-[11px]',
            result.ok ? 'text-accent' : 'text-amber-400'
          )}
        >
          {result.ok ? (
            <CheckCircle2 className="size-3 shrink-0" />
          ) : (
            <XCircle className="size-3 shrink-0" />
          )}
          <span className="truncate">
            {result.ok
              ? (result.message ?? t('settings.providers.test_ok'))
              : t('settings.providers.test_failed', { error: result.message ?? '' })}
          </span>
        </span>
      )}
    </div>
  )
}

// Recommended models offered for one-click pull. A small, sane default set —
// the user can still pull anything via `ollama pull` in a terminal.
const OLLAMA_RECOMMENDED = PROVIDER_FAST_MODELS.ollama.slice(0, 4)

/**
 * Ollama model manager. Lists installed models from the health probe and lets
 * the user pull recommended ones with a busy state (the `ollama.pull` IPC was
 * registered but never called from the renderer before this). Warns when
 * Privacy Mode is on with Ollama selected but no models are installed — that
 * combination silently fails on the first prompt.
 */
function OllamaModelManager({
  ollama,
  onRefresh,
  privacyMode
}: {
  ollama: OllamaHealthType | null
  onRefresh(): void
  privacyMode: boolean
}) {
  const { t } = useTranslation()
  const [pulling, setPulling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const installed = new Set(ollama?.models ?? [])
  const reachable = ollama?.running ?? false
  const noModels = reachable && (ollama?.models.length ?? 0) === 0

  async function pull(name: string) {
    setPulling(name)
    setError(null)
    try {
      const ok = await window.zanban.ollama.pull(name)
      if (!ok) setError(t('settings.providers.ollama_pull_failed', { name }))
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPulling(null)
    }
  }

  if (!reachable) return null

  return (
    <div className="flex flex-col gap-2">
      {privacyMode && noModels && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{t('settings.providers.ollama_privacy_no_models')}</span>
        </div>
      )}
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('settings.providers.ollama_recommended_label')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {OLLAMA_RECOMMENDED.map((name) => {
          const has = installed.has(name)
          const busy = pulling === name
          return (
            <Button
              key={name}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 font-mono text-[11px]"
              disabled={has || busy || pulling !== null}
              onClick={() => void pull(name)}
              title={
                has
                  ? t('settings.providers.ollama_installed_title')
                  : t('settings.providers.ollama_pull_title', { name })
              }
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : has ? (
                <CheckCircle2 className="size-3 text-accent" />
              ) : (
                <Download className="size-3" />
              )}
              {name}
            </Button>
          )
        })}
      </div>
      {error && <div className="text-[11px] text-amber-400">{error}</div>}
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
      <div className="flex flex-col gap-2">
        <SecretKeyField
          label={t(`settings.providers.llm.${provider}.key_label`)}
          placeholder={field.placeholder}
          value={settings[field.settingsKey] ?? ''}
          onChange={(v) => update(field.settingsKey, v || null)}
        />
        <ProviderTestButton provider={provider} disabled={!settings[field.settingsKey]} />
      </div>
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
        <OllamaModelManager
          ollama={ollama}
          onRefresh={onRefreshOllama}
          privacyMode={settings.privacyMode}
        />
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
