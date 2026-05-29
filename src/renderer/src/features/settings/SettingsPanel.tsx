import { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  RefreshCw,
  Cpu,
  User,
  Keyboard,
  SlidersHorizontal,
  Info,
  FolderOpen,
  Headphones,
  Zap,
  Check,
  FileText
} from 'lucide-react'
import {
  DEFAULT_SETTINGS,
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_FAST_MODELS,
  PROVIDER_VISION_MODELS,
  type AiModelSettings,
  type AiRole,
  type AppSettings
} from '@shared/types'
import { enumerateMics, type MicDevice } from '@renderer/lib/audio'
import { KeyRecorder } from './KeyRecorder'
import { ReferenceDocsTab } from './ReferenceDocsTab'
import { PersonasTab } from './PersonasTab'
import { ProvidersTab, SttProviderCards, WebSearchCard, LLM_PROVIDERS } from './ProvidersTab'
import { RecapSettingsTab } from './RecapSettingsTab'
import { OverlayMockup } from './OverlayMockup'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

// Settings IDs the rest of the app passes around. The legacy `providers`,
// `models`, and `documents` ids are kept as aliases (mapped to their merged
// tabs in resolveTab) so deeper jump-to-tab links still work — search hits,
// the overlay's "API keys not configured" alert, etc.
export type SettingsTabId =
  | 'general'
  | 'audio'
  | 'ai'
  | 'identity'
  | 'recap'
  | 'hotkeys'
  | 'about'
  // legacy aliases — accepted as input, mapped to merged tabs internally:
  | 'providers'
  | 'models'
  | 'persona'
  | 'documents'

type TabId = 'general' | 'audio' | 'ai' | 'identity' | 'recap' | 'hotkeys' | 'about'

function resolveTab(id: SettingsTabId): TabId {
  if (id === 'providers' || id === 'models') return 'ai'
  if (id === 'persona' || id === 'documents') return 'identity'
  return id
}

export const SETTINGS_TABS: Array<{
  id: SettingsTabId
  label: string
  keywords: string[]
}> = [
  {
    id: 'general',
    label: 'General',
    keywords: [
      'general',
      'privacy',
      'stealth',
      'detectable',
      'hide widget',
      'auto detect questions',
      'transcript window',
      'sessions folder',
      'dock',
      'opacity',
      'appearance'
    ]
  },
  {
    id: 'ai',
    label: 'AI',
    keywords: [
      'ai',
      'models',
      'llm',
      'gateway',
      'vercel',
      'api key',
      'openai',
      'gpt',
      'claude',
      'gemini',
      'groq',
      'ollama',
      'anthropic',
      'tavily',
      'elevenlabs',
      'fast',
      'filter',
      'summary',
      'vision',
      'token',
      'secret',
      'privacy mode',
      'providers'
    ]
  },
  {
    id: 'audio',
    label: 'Audio',
    keywords: [
      'audio',
      'mic',
      'microphone',
      'system audio',
      'loopback',
      'device',
      'vad',
      'transcription',
      'language',
      'stt',
      'speech to text',
      'multilingual'
    ]
  },
  {
    id: 'identity',
    label: 'Identity',
    keywords: [
      'persona',
      'preset',
      'response language',
      'reply language',
      'meeting context',
      'system prompt',
      'documents',
      'reference',
      'pdf',
      'docx',
      'txt',
      'context',
      'resume',
      'spec',
      'brief'
    ]
  },
  {
    id: 'recap',
    label: 'Recap',
    keywords: [
      'recap',
      'post-meeting',
      'summary',
      'auto generate',
      'tone',
      'concise',
      'friendly',
      'formal',
      'language',
      'model override'
    ]
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    keywords: ['hotkeys', 'keybinds', 'keyboard', 'shortcut', 'shortcuts', 'accelerator', 'rebind']
  },
  { id: 'about', label: 'About', keywords: ['about', 'version', 'changelog'] }
]

const TABS: Array<{ id: TabId; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'general', icon: SlidersHorizontal },
  { id: 'ai', icon: Cpu },
  { id: 'audio', icon: Headphones },
  { id: 'identity', icon: User },
  { id: 'recap', icon: FileText },
  { id: 'hotkeys', icon: Keyboard },
  { id: 'about', icon: Info }
]

export function SettingsPanel({
  initialTab,
  onReRunOnboarding
}: { initialTab?: SettingsTabId; onReRunOnboarding?: () => void } = {}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>(initialTab ? resolveTab(initialTab) : 'general')

  useEffect(() => {
    if (initialTab) setTab(resolveTab(initialTab))
  }, [initialTab])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [mics, setMics] = useState<MicDevice[]>([])
  const [micsError, setMicsError] = useState<string | null>(null)
  const [version, setVersion] = useState<string>('')
  // Skip the very first auto-save trigger — that one fires when settings load
  // from main, and re-saving freshly-loaded settings is a wasted round-trip.
  const initialized = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.zanban.settings.get().then(setSettings)
    void window.zanban.getVersion().then(setVersion)
    void enumerateMics()
      .then(setMics)
      .catch((e) => setMicsError(String(e)))
  }, [])

  // Auto-save: any change to `settings` is pushed to main with a short debounce.
  // Removes the Save button entirely — toggles like Detectable now apply the
  // moment the user flips them, which is what they expect from a settings panel.
  useEffect(() => {
    if (!settings) return
    if (!initialized.current) {
      initialized.current = true
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSavingState('saving')
    debounceRef.current = setTimeout(() => {
      window.zanban.settings
        .set(settings)
        .then(() => {
          setSavingState('saved')
          if (savedFlashRef.current) clearTimeout(savedFlashRef.current)
          savedFlashRef.current = setTimeout(() => setSavingState('idle'), 1400)
        })
        .catch((err) => {
          setSavingState('idle')
          toast.error('Failed to save', { description: String(err) })
        })
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [settings])

  async function rescanMics(): Promise<void> {
    setMicsError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const t of stream.getTracks()) t.stop()
      setMics(await enumerateMics())
    } catch (err) {
      setMicsError(err instanceof Error ? err.message : 'unknown')
    }
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setSettings((s) => (s ? { ...s, [key]: value } : s))
  }

  function updateHotkey(key: keyof AppSettings['hotkeys'], value: string): void {
    setSettings((s) => (s ? { ...s, hotkeys: { ...s.hotkeys, [key]: value } } : s))
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-3.5 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <SettingsSidebar tab={tab} setTab={setTab} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-8 py-7">
          {tab === 'general' && (
            <GeneralTab settings={settings} update={update} onReRunOnboarding={onReRunOnboarding} />
          )}
          {tab === 'ai' && (
            <>
              <ProvidersTab settings={settings} update={update} />
              <Section
                title={t('settings.ai.models_card_title')}
                hint={t('settings.ai.models_card_hint')}
              >
                <ModelsTab settings={settings} update={update} />
              </Section>
              <Section
                title={t('settings.ai.web_search_title')}
                hint={t('settings.ai.web_search_hint')}
              >
                <WebSearchCard settings={settings} update={update} />
              </Section>
            </>
          )}
          {tab === 'audio' && (
            <AudioTab
              settings={settings}
              update={update}
              mics={mics}
              micsError={micsError}
              onRescan={() => void rescanMics()}
            />
          )}
          {tab === 'identity' && (
            <>
              <PersonasTab settings={settings} update={update} />
              <div className="mt-10 mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t('settings.identity.reference_documents_divider')}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <ReferenceDocsTab />
            </>
          )}
          {tab === 'recap' && <RecapSettingsTab settings={settings} update={update} />}
          {tab === 'hotkeys' && (
            <HotkeysTab
              settings={settings}
              updateHotkey={updateHotkey}
              resetAll={() =>
                setSettings((s) => (s ? { ...s, hotkeys: { ...DEFAULT_SETTINGS.hotkeys } } : s))
              }
            />
          )}
          {tab === 'about' && <AboutTab version={version} />}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/20 px-8 py-3">
          <div className="text-[11px] text-muted-foreground">{t('settings.footer_note')}</div>
          <div className="flex h-7 items-center gap-1.5 text-[11px] text-muted-foreground">
            {savingState === 'saving' && (
              <>
                <Loader2 className="size-3 animate-spin" />
                {t('settings.saving')}
              </>
            )}
            {savingState === 'saved' && (
              <>
                <Check className="size-3 text-emerald-400/80" />
                {t('settings.saved')}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsSidebar({ tab, setTab }: { tab: TabId; setTab(v: TabId): void }) {
  const { t: tr } = useTranslation()
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-3 border-r border-white/[0.06] bg-white/[0.012] py-5 pl-5 pr-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {tr('settings.sidebar_title')}
      </h2>
      <nav className="flex flex-col">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                // Underline-tab analogue for the vertical axis: 1px leading
                // border that lights up on active. No filled pill background —
                // keeps the panel quieter and the active state unambiguous
                // even from the corner of the eye.
                'group relative flex items-center gap-2.5 border-l py-2 pl-3 pr-2 text-[13px] transition-colors',
                active
                  ? 'border-foreground/80 text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              )}
            >
              <t.icon className="size-3.5 opacity-80" />
              {tr(`settings.tabs.${t.id}`)}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

function Section({
  title,
  children,
  hint
}: {
  title: string
  children: React.ReactNode
  hint?: string
}) {
  // Section header: monospace eyebrow + plain title. Wide bottom margin
  // (40px) gives the page a clear rhythm so adjacent groups don't blur
  // into one wall of rows.
  return (
    <section className="mb-10 first:mt-0">
      <div className="mb-4 flex flex-col gap-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </div>
        {hint && <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <div className="pt-1.5">
        <div className="text-[13px] text-foreground/85">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function GeneralTab({
  settings,
  update,
  onReRunOnboarding
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  onReRunOnboarding?: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Section
        title={t('settings.general.appearance_title')}
        hint={t('settings.general.appearance_hint')}
      >
        <OpacityField
          // Clamp stored value into the slider's range so legacy/manual sub-min
          // values display correctly and don't desync the thumb position.
          value={Math.max(0.4, Math.min(1, settings.overlayOpacity ?? 1))}
          onChange={(v) => update('overlayOpacity', v)}
        />
      </Section>
      <Section
        title={t('settings.general.language_title')}
        hint={t('settings.general.language_hint')}
      >
        <Select
          value={settings.uiLocale ?? 'en'}
          onValueChange={(v) => update('uiLocale', v as 'en' | 'ru')}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ru">Русский</SelectItem>
          </SelectContent>
        </Select>
      </Section>
      <Section
        title={t('settings.general.privacy_title')}
        hint={t('settings.general.privacy_hint')}
      >
        <Row label={t('settings.general.stealth_label')} hint={t('settings.general.stealth_hint')}>
          {/* Inverse of `detectable` to remove the double-negative ("off = invisible")
              that was confusing in the previous label. The setting key stays
              `detectable` for backwards compat — only the UI flips. */}
          <Switch
            checked={!settings.detectable}
            onCheckedChange={(v) => update('detectable', !v)}
          />
        </Row>
        <Row
          label={t('settings.general.hide_widget_label')}
          hint={t('settings.general.hide_widget_hint')}
        >
          <Switch
            checked={settings.hideWidgetWhenHidden}
            onCheckedChange={(v) => update('hideWidgetWhenHidden', v)}
          />
        </Row>
        <Row
          label={t('settings.general.hide_app_switcher_label')}
          hint={t('settings.general.hide_app_switcher_hint')}
        >
          <Switch
            checked={settings.hideFromAppSwitcher}
            onCheckedChange={(v) => update('hideFromAppSwitcher', v)}
          />
        </Row>
      </Section>
      <Section
        title={t('settings.general.assistant_title')}
        hint={t('settings.general.assistant_hint')}
      >
        <Field
          label={t('settings.general.transcript_window_label')}
          hint={t('settings.general.transcript_window_hint')}
        >
          <TranscriptWindowInput
            value={settings.contextSeconds}
            onCommit={(n) => update('contextSeconds', n)}
          />
        </Field>
      </Section>
      <Section
        title={t('settings.general.sessions_title')}
        hint={t('settings.general.sessions_hint')}
      >
        <div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void window.zanban.sessions.revealFolder()}
          >
            <FolderOpen className="size-3.5" />
            {t('settings.general.open_sessions_folder')}
          </Button>
        </div>
      </Section>
      {onReRunOnboarding && (
        <Section title={t('settings.general.setup_title')} hint={t('settings.general.setup_hint')}>
          <div>
            <Button variant="outline" size="sm" className="gap-2" onClick={onReRunOnboarding}>
              {t('settings.general.rerun_onboarding')}
            </Button>
          </div>
        </Section>
      )}
    </>
  )
}

function ModelsTab({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const { t } = useTranslation()
  const provider = settings.llmProvider
  const providerOverrides: AiModelSettings = settings.aiModels?.[provider] ?? {
    fast: '',
    filter: '',
    summary: '',
    vision: ''
  }

  function setModel(role: AiRole, value: string): void {
    const next: AppSettings['aiModels'] = {
      ...settings.aiModels,
      [provider]: { ...providerOverrides, [role]: value }
    }
    update('aiModels', next)
  }

  function resetForProvider(): void {
    const next = { ...settings.aiModels }
    delete next[provider]
    update('aiModels', next)
  }

  const providerDefaults = PROVIDER_MODEL_DEFAULTS[provider]
  const hasAnyOverride = (Object.keys(providerOverrides) as AiRole[]).some((r) =>
    providerOverrides[r]?.trim()
  )

  // Vision can ride a different provider via the visionProvider override.
  // The vision-row's model picker therefore needs to use the override
  // provider's catalogue when set, falling back to the LLM provider's.
  const visionProvider = settings.visionProvider ?? provider
  const visionOverrides: AiModelSettings = settings.aiModels?.[visionProvider] ?? {
    fast: '',
    filter: '',
    summary: '',
    vision: ''
  }
  const visionDefaults = PROVIDER_MODEL_DEFAULTS[visionProvider]

  function setVisionModel(value: string): void {
    const next: AppSettings['aiModels'] = {
      ...settings.aiModels,
      [visionProvider]: { ...visionOverrides, vision: value }
    }
    update('aiModels', next)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Showing models for <span className="font-mono text-foreground">{provider}</span>. Each
            provider keeps its own per-role IDs — switching providers above doesn't lose what you
            typed here.
          </p>
        </div>
        {hasAnyOverride && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-[11px] text-muted-foreground"
            onClick={resetForProvider}
          >
            {t('settings.ai.reset_to_defaults')}
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
        <div className="flex flex-col gap-3">
          <ModelRoleField
            label={t('settings.ai.streaming_label')}
            hint={t('settings.ai.streaming_hint')}
            value={providerOverrides.fast ?? ''}
            fallback={providerDefaults.fast}
            options={PROVIDER_FAST_MODELS[provider] ?? []}
            onChange={(v) => setModel('fast', v)}
          />
          <Divider />
          <ModelRoleField
            label={t('settings.ai.question_detector_label')}
            hint={t('settings.ai.question_detector_hint')}
            value={providerOverrides.filter ?? ''}
            fallback={providerDefaults.filter}
            options={PROVIDER_FAST_MODELS[provider] ?? []}
            onChange={(v) => setModel('filter', v)}
          />
          <Divider />
          <ModelRoleField
            label={t('settings.ai.session_title_label')}
            hint={t('settings.ai.session_title_hint')}
            value={providerOverrides.summary ?? ''}
            fallback={providerDefaults.summary}
            options={PROVIDER_FAST_MODELS[provider] ?? []}
            onChange={(v) => setModel('summary', v)}
          />
        </div>
      </div>

      {/* Vision — its own card so the dual contol (provider + model) stands
          apart from the text roles. The user can route screenshots through
          a different vendor than text. */}
      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{t('settings.ai.vision_title')}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t('settings.ai.vision_hint')}
            </p>
          </div>
        </div>

        {/* Two-row sub-grid: provider picker + provider's vision-model picker. */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[120px_1fr] items-center gap-3">
            <label className="text-[11px] text-muted-foreground">
              {t('settings.ai.provider_label')}
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
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__same__">
                  {t('settings.ai.same_as_text', { provider })}
                </SelectItem>
                {LLM_PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {t(`settings.providers.llm.${p.value}.name`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-3">
            <label className="text-[11px] text-muted-foreground">
              {t('settings.ai.model_label')}
            </label>
            <ModelOptionSelect
              value={visionOverrides.vision ?? ''}
              fallback={visionDefaults.vision}
              options={PROVIDER_VISION_MODELS[visionProvider] ?? []}
              onChange={setVisionModel}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function Divider() {
  return <div className="h-px w-full bg-white/[0.05]" />
}

function ModelRoleField({
  label,
  hint,
  value,
  fallback,
  options,
  onChange
}: {
  label: string
  hint: string
  value: string
  fallback: string
  /** Per-provider catalogue for the role. Empty array = no curated options. */
  options: string[]
  onChange(value: string): void
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <div className="pt-1">
        <div className="text-[12.5px] font-medium text-foreground/90">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div>
      </div>
      <ModelOptionSelect value={value} fallback={fallback} options={options} onChange={onChange} />
    </div>
  )
}

function ModelOptionSelect({
  value,
  fallback,
  options,
  onChange
}: {
  value: string
  fallback: string
  options: string[]
  onChange(v: string): void
}) {
  const { t } = useTranslation()
  // Empty value = "use the provider default" — show fallback in the trigger,
  // but the select highlight stays cleared so the user sees they're on auto.
  const matched = options.includes(value) ? value : ''
  return (
    <div className="flex flex-col gap-1.5">
      <Select value={matched} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('settings.ai.default_placeholder', { model: fallback })} />
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <SelectItem key={m} value={m}>
              <span className="font-mono text-xs">{m}</span>
              {m === fallback && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {t('settings.ai.default_chip')}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Input
          className="font-mono text-[11px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('settings.ai.custom_id_placeholder', { model: fallback })}
        />
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => onChange('')}
            title={t('settings.ai.reset_to_default')}
          >
            <Zap className="size-3" />
            {t('settings.ai.default_chip')}
          </Button>
        )}
      </div>
    </div>
  )
}

function AudioTab({
  settings,
  update,
  mics,
  micsError,
  onRescan
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  mics: MicDevice[]
  micsError: string | null
  onRescan(): void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Section title={t('settings.audio.capture_title')} hint={t('settings.audio.capture_hint')}>
        <Field label={t('settings.audio.mic_label')}>
          <div className="flex items-center gap-2">
            <Select
              value={settings.audio.micDeviceId ?? 'default'}
              onValueChange={(v) =>
                update('audio', {
                  ...settings.audio,
                  micDeviceId: v === 'default' ? null : v
                })
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('settings.audio.default_device')}</SelectItem>
                {mics.map((m) => (
                  <SelectItem key={m.deviceId} value={m.deviceId}>
                    {m.label || t('settings.audio.device_unnamed', { id: m.deviceId.slice(0, 8) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              title={t('settings.audio.rescan_tooltip')}
              onClick={onRescan}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          {micsError && <p className="mt-2 text-xs text-destructive">{micsError}</p>}
        </Field>
        <Row label={t('settings.audio.system_label')} hint={t('settings.audio.system_hint')}>
          <Switch
            checked={settings.audio.systemEnabled}
            onCheckedChange={(v) => update('audio', { ...settings.audio, systemEnabled: v })}
          />
        </Row>
        <Row label={t('settings.audio.vad_label')} hint={t('settings.audio.vad_hint')}>
          <Switch
            checked={settings.audio.vadEnabled}
            onCheckedChange={(v) => update('audio', { ...settings.audio, vadEnabled: v })}
          />
        </Row>
      </Section>

      <Section title={t('settings.audio.stt_title')} hint={t('settings.audio.stt_hint')}>
        <SttProviderCards settings={settings} update={update} />
      </Section>

      <TranscriptionLanguageSection settings={settings} update={update} />
    </>
  )
}

// Language labels are pulled from i18n at render time (see
// `settings.transcription.lang.*`). Only the value + flag stay here.
const TRANSCRIPTION_LANGUAGES_POPULAR: Array<{ value: string; flag: string }> = [
  { value: 'multi', flag: '🌐' },
  { value: 'en', flag: '🇬🇧' },
  { value: 'ru', flag: '🇷🇺' },
  { value: 'es', flag: '🇪🇸' },
  { value: 'de', flag: '🇩🇪' },
  { value: 'fr', flag: '🇫🇷' }
]

const TRANSCRIPTION_LANGUAGES_OTHER: Array<{ value: string; flag: string }> = [
  { value: 'it', flag: '🇮🇹' },
  { value: 'pt', flag: '🇵🇹' },
  { value: 'nl', flag: '🇳🇱' },
  { value: 'pl', flag: '🇵🇱' },
  { value: 'tr', flag: '🇹🇷' },
  { value: 'uk', flag: '🇺🇦' },
  { value: 'ja', flag: '🇯🇵' },
  { value: 'ko', flag: '🇰🇷' },
  { value: 'zh', flag: '🇨🇳' },
  { value: 'hi', flag: '🇮🇳' },
  { value: 'ar', flag: '🇸🇦' }
]

function TranscriptionLanguageSection({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const { t } = useTranslation()
  // Different STT providers handle 'multi' differently — Deepgram has native
  // multilingual streaming, the others do per-utterance language detection or
  // require a single locked language. The hint changes accordingly so the
  // user knows what to expect for THEIR provider.
  const provider = settings.sttProvider
  const supportsMulti = provider === 'deepgram' || provider === 'openai-whisper'
  const findLang = (v: string) =>
    [...TRANSCRIPTION_LANGUAGES_POPULAR, ...TRANSCRIPTION_LANGUAGES_OTHER].find(
      (l) => l.value === v
    )

  const current = findLang(settings.transcriptionLanguage)
  return (
    <Section
      title={t('settings.transcription.title')}
      hint={
        supportsMulti
          ? t('settings.transcription.hint_multi', { provider })
          : t('settings.transcription.hint_single', { provider })
      }
    >
      <Field label={t('settings.transcription.language_label')}>
        <Select
          value={settings.transcriptionLanguage}
          onValueChange={(v) => update('transcriptionLanguage', v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {current
                ? `${current.flag}  ${t(`settings.transcription.lang.${current.value}`)}`
                : settings.transcriptionLanguage}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('settings.transcription.popular')}
            </div>
            {TRANSCRIPTION_LANGUAGES_POPULAR.filter(
              (l) => l.value !== 'multi' || supportsMulti
            ).map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="mr-2">{l.flag}</span>
                {t(`settings.transcription.lang.${l.value}`)}
              </SelectItem>
            ))}
            <div className="mt-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('settings.transcription.other')}
            </div>
            {TRANSCRIPTION_LANGUAGES_OTHER.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="mr-2">{l.flag}</span>
                {t(`settings.transcription.lang.${l.value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="text-[11px] text-muted-foreground">
        {t('settings.transcription.switch_provider_note_before')}{' '}
        <span className="font-mono">{t('settings.transcription.switch_provider_note_tab')}</span>
        {t('settings.transcription.switch_provider_note_after')}
      </p>
    </Section>
  )
}

function HotkeysTab({
  settings,
  updateHotkey,
  resetAll
}: {
  settings: AppSettings
  updateHotkey(key: keyof AppSettings['hotkeys'], value: string): void
  resetAll(): void
}) {
  const { t } = useTranslation()
  const allDefault = (Object.keys(settings.hotkeys) as Array<keyof AppSettings['hotkeys']>).every(
    (k) => settings.hotkeys[k] === DEFAULT_SETTINGS.hotkeys[k]
  )

  return (
    <Section title={t('settings.hotkeys_section.title')} hint={t('settings.hotkeys_section.hint')}>
      <div className="flex flex-col gap-2">
        {(Object.keys(settings.hotkeys) as Array<keyof AppSettings['hotkeys']>).map((k) => (
          <Field
            key={k}
            label={t(`settings.hotkey.${k}.label`)}
            hint={t(`settings.hotkey.${k}.hint`)}
          >
            <KeyRecorder
              value={settings.hotkeys[k]}
              defaultValue={DEFAULT_SETTINGS.hotkeys[k]}
              onChange={(v) => updateHotkey(k, v)}
            />
          </Field>
        ))}
      </div>
      {!allDefault && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={resetAll}>
            {t('settings.hotkeys_section.reset_all')}
          </Button>
        </div>
      )}
    </Section>
  )
}

function AboutTab({ version }: { version: string }) {
  const { t } = useTranslation()
  return (
    <Section title={t('settings.about.title')}>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-baseline gap-2">
          <div className="text-base font-semibold">Zanban</div>
          <div className="font-mono text-[11px] text-muted-foreground">v{version || '…'}</div>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{t('settings.about.description')}</p>
      </div>
    </Section>
  )
}

function Row({
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
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </label>
  )
}

function TranscriptWindowInput({ value, onCommit }: { value: number; onCommit(v: number): void }) {
  // Uncontrolled-ish: user can type freely (including clearing the field).
  // Persistence + clamping happens on blur/Enter so we don't fight the user's
  // keystrokes. Re-syncs to props if external value changes.
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])
  const commit = (): void => {
    const n = Number(draft)
    const clamped = Number.isFinite(n) ? Math.max(10, Math.min(600, n)) : value
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <Input
      type="number"
      className="w-28 font-mono"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

function OpacityField({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <div className="pt-1.5">
        <div className="text-[13px] text-foreground/85">Interface opacity</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Blend the floating overlay into the screen background. Useful when a meeting tile is
          bright. 100% = solid.
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <OpacitySlider value={value} onChange={onChange} />
        <OverlayPreview opacity={value} />
      </div>
    </div>
  )
}

function OverlayPreview({ opacity }: { opacity: number }) {
  // Preview canvas: a faked desktop tile with the REAL overlay chrome on top,
  // rendered at native size (max-w 680px) and scaled down via CSS transform
  // so the user judges opacity against pixel-perfect chrome rather than a
  // stylized approximation. The mockup shares its JSX/classes with
  // OverlayApp.tsx — see OverlayMockup.tsx.
  const clamped = Math.min(1, Math.max(0.4, opacity))
  // Native overlay content is ~720px wide (max-w 680 + p-3). Pick a scale
  // that fits a comfortable preview tile width without becoming illegible.
  const scale = 0.55
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-white/[0.06]"
      style={{
        height: 320,
        background:
          'linear-gradient(135deg, oklch(0.32 0.02 220) 0%, oklch(0.22 0.018 240) 50%, oklch(0.18 0.02 280) 100%)'
      }}
    >
      {/* faux meeting tiles in a 2x2 grid — recedes the bg so the overlay
          chrome reads as a separate object floating on top */}
      <div className="absolute inset-3 grid grid-cols-2 gap-1.5 rounded border border-white/[0.04]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded border border-white/[0.03]"
            style={{
              background: `oklch(${0.22 + i * 0.02} 0.014 ${220 + i * 18})`
            }}
          />
        ))}
      </div>
      {/* The actual overlay chrome at native pixel size, scaled down. Native
          width matches OverlayApp's max-w-[680px] so component pixels in
          the preview match what the user will see at 100% opacity. */}
      <div
        className="absolute left-1/2 top-2"
        style={{
          width: 720,
          marginLeft: -360,
          opacity: clamped,
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          transition: 'opacity 120ms ease-out'
        }}
      >
        <OverlayMockup />
      </div>
      {/* corner readout — confirms the % the user is dragging without making
          them look up at the slider's tail. */}
      <div className="absolute bottom-1.5 right-2 font-mono text-[9px] text-muted-foreground/70">
        {Math.round(clamped * 100)}% preview
      </div>
    </div>
  )
}

function OpacitySlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  // Floor mirrors the clamp in main/index.ts → applyOverlayOpacity. Letting the
  // user drag below this would risk dragging the overlay below visibility on
  // glance-and-recover.
  const min = 0.4
  const max = 1
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          'h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.08]',
          // The track is rendered via accent on supported browsers — fallback
          // is the white/0.08 background. Keep the thumb a single circle in
          // foreground color so it reads against any backdrop.
          '[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground',
          '[&::-webkit-slider-thumb]:shadow-[0_0_0_3px_oklch(1_0_0/0.06)]',
          '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground'
        )}
        style={{ accentColor: 'oklch(0.78 0.13 145)' }}
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  )
}
