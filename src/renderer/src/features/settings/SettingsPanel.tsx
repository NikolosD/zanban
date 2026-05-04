import { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  Cpu,
  Mic,
  User,
  Keyboard,
  SlidersHorizontal,
  Info,
  FolderOpen,
  Headphones,
  Zap,
  Check
} from 'lucide-react'
import {
  PERSONA_PRESETS,
  DEFAULT_SETTINGS,
  PROVIDER_MODEL_DEFAULTS,
  AI_MODEL_SUGGESTIONS,
  RESPONSE_LANGUAGES,
  STT_PROVIDERS,
  type AiModelSettings,
  type AiRole,
  type AppSettings,
  type ResponseLanguage,
  type SttProvider
} from '@shared/types'
import { KeyRecorder } from './KeyRecorder'
import { ReferenceDocsTab, REFERENCE_DOCS_ICON } from './ReferenceDocsTab'
import { PersonasTab } from './PersonasTab'
import { ProvidersTab, PROVIDERS_ICON } from './ProvidersTab'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { toast } from 'sonner'
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
  | 'hotkeys'
  | 'about'
  // legacy aliases — accepted as input, mapped to merged tabs internally:
  | 'providers'
  | 'models'
  | 'persona'
  | 'documents'

type TabId = 'general' | 'audio' | 'ai' | 'identity' | 'hotkeys' | 'about'

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
    label: 'general',
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
    label: 'ai',
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
    label: 'audio',
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
    label: 'identity',
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
    id: 'hotkeys',
    label: 'hotkeys',
    keywords: ['hotkeys', 'keybinds', 'keyboard', 'shortcut', 'shortcuts', 'accelerator', 'rebind']
  },
  { id: 'about', label: 'about', keywords: ['about', 'version', 'changelog'] }
]

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'general', label: 'general', icon: SlidersHorizontal },
  { id: 'ai', label: 'ai', icon: Cpu },
  { id: 'audio', label: 'audio', icon: Headphones },
  { id: 'identity', label: 'identity', icon: User },
  { id: 'hotkeys', label: 'hotkeys', icon: Keyboard },
  { id: 'about', label: 'about', icon: Info }
]

interface MicDevice {
  deviceId: string
  label: string
}

export function SettingsPanel({ initialTab }: { initialTab?: SettingsTabId } = {}) {
  const [tab, setTab] = useState<TabId>(initialTab ? resolveTab(initialTab) : 'general')

  useEffect(() => {
    if (initialTab) setTab(resolveTab(initialTab))
  }, [initialTab])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [reveal, setReveal] = useState({
    google: false,
    deepgram: false,
    vercel: false
  })
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
    void enumerateMics().then(setMics).catch((e) => setMicsError(String(e)))
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
            <GeneralTab
              settings={settings}
              update={update}
            />
          )}
          {tab === 'ai' && (
            <>
              <ProvidersTab settings={settings} update={update} />
              <div className="mt-10 mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  models per role
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <ModelsTab settings={settings} update={update} />
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
                  reference documents
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <ReferenceDocsTab />
            </>
          )}
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
          <div className="text-[11px] text-muted-foreground">
            Changes apply automatically. Secrets stored in your OS keychain.
          </div>
          <div className="flex h-7 items-center gap-1.5 text-[11px] text-muted-foreground">
            {savingState === 'saving' && (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving…
              </>
            )}
            {savingState === 'saved' && (
              <>
                <Check className="size-3 text-emerald-400/80" />
                Saved
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsSidebar({ tab, setTab }: { tab: TabId; setTab(v: TabId): void }) {
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-3 border-r border-white/[0.06] bg-white/[0.012] py-5 pl-5 pr-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        settings
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
              {t.label}
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
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  return (
    <>
      <Section
        title="appearance"
        hint="How the overlay sits on your screen during a call."
      >
        <OpacityField
          value={settings.overlayOpacity ?? 1}
          onChange={(v) => update('overlayOpacity', v)}
        />
      </Section>
      <Section
        title="privacy"
        hint="How the floating widget behaves around screen-sharing and Hide."
      >
        <Row
          label="Stealth mode"
          hint="On (default): the overlay is invisible to screen-share and recording. Off: shows up like any normal window."
        >
          {/* Inverse of `detectable` to remove the double-negative ("off = invisible")
              that was confusing in the previous label. The setting key stays
              `detectable` for backwards compat — only the UI flips. */}
          <Switch
            checked={!settings.detectable}
            onCheckedChange={(v) => update('detectable', !v)}
          />
        </Row>
        <Row
          label="Hide widget when hiding"
          hint="When you toggle Hide, also collapse the chips/input so only the tiny status pill remains."
        >
          <Switch
            checked={settings.hideWidgetWhenHidden}
            onCheckedChange={(v) => update('hideWidgetWhenHidden', v)}
          />
        </Row>
        <Row
          label="Hide dock icon (macOS)"
          hint="Stay invisible in the dock. Restart the app for changes to apply. No effect on Windows/Linux."
        >
          <Switch
            checked={settings.hideDockMacOS}
            onCheckedChange={(v) => update('hideDockMacOS', v)}
          />
        </Row>
      </Section>
      <Section
        title="assistant"
        hint="How proactively Zanban surfaces helpers during the call."
      >
        <Row
          label="Auto-detect questions from the other speaker"
          hint="When the other side asks something, surface it as a chip you can answer in one click."
        >
          <Switch
            checked={settings.autoDetectQuestions}
            onCheckedChange={(v) => update('autoDetectQuestions', v)}
          />
        </Row>
        <Field
          label="Transcript window"
          hint="Seconds of recent audio sent as context for each Ask."
        >
          <Input
            type="number"
            className="w-28 font-mono"
            value={settings.contextSeconds}
            onChange={(e) =>
              update('contextSeconds', Math.max(10, Math.min(600, Number(e.target.value))))
            }
          />
        </Field>
      </Section>
      <Section
        title="sessions"
        hint="Stored locally as Markdown + JSON. Open the folder to grep or back up."
      >
        <div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void window.zanban.sessions.revealFolder()}
          >
            <FolderOpen className="size-3.5" />
            Open sessions folder
          </Button>
        </div>
      </Section>
    </>
  )
}

type RevealState = { google: boolean; deepgram: boolean; vercel: boolean }

function ModelsTab({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const provider = settings.llmProvider
  const providerOverrides: AiModelSettings =
    settings.aiModels?.[provider] ?? { fast: '', filter: '', summary: '', vision: '' }

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
  const hasAnyOverride = (Object.keys(providerOverrides) as AiRole[]).some(
    (r) => providerOverrides[r]?.trim()
  )

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px]">
        <div className="text-muted-foreground">
          Showing models for <span className="font-mono text-foreground">{provider}</span>.
          Switch the provider in <span className="font-mono">Providers</span> — each
          provider keeps its own per-role IDs, so you don't have to retype them
          when toggling between e.g. Anthropic and Gemini.
        </div>
        {hasAnyOverride && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-[11px] text-muted-foreground"
            onClick={resetForProvider}
          >
            Reset to defaults
          </Button>
        )}
      </div>
      <Section
        title={`Models per role · ${provider}`}
        hint="Empty = use the provider's default (shown as placeholder). Paste any model ID the provider supports."
      >
        <ModelRoleField
          role="fast"
          label="Streaming answers"
          hint="Used for the Ask hotkey, Answer last, and any text question. Pick the lowest-latency model you trust — this is what the user feels."
          override={providerOverrides.fast}
          fallback={providerDefaults.fast}
          setModel={setModel}
        />
        <ModelRoleField
          role="filter"
          label="Question detector"
          hint="Cheap classifier that scans the other speaker's transcript and decides 'is this a question?' Runs constantly — keep it cheap and fast."
          override={providerOverrides.filter}
          fallback={providerDefaults.filter}
          setModel={setModel}
        />
        <ModelRoleField
          role="summary"
          label="Session title"
          hint="Generates a short title at the end of a recorded call. Quality matters more than latency."
          override={providerOverrides.summary}
          fallback={providerDefaults.summary}
          setModel={setModel}
        />
        <ModelRoleField
          role="vision"
          label="Vision (screenshots)"
          hint="Used when you snap a screenshot and ask about it. Must be multimodal."
          override={providerOverrides.vision}
          fallback={providerDefaults.vision}
          setModel={setModel}
        />
      </Section>
    </>
  )
}

function ModelRoleField({
  role,
  label,
  hint,
  override,
  fallback,
  setModel
}: {
  role: AiRole
  label: string
  hint: string
  override: string | undefined
  fallback: string
  setModel(role: AiRole, value: string): void
}) {
  const value = override ?? ''
  const suggestions = AI_MODEL_SUGGESTIONS[role]
  // Match by exact ID. Empty string = "use default" → no select highlighting.
  const matchedSuggestion = suggestions.includes(value) ? value : ''

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-2">
        <Select
          value={matchedSuggestion}
          onValueChange={(v) => setModel(role, v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`Default · ${fallback}`} />
          </SelectTrigger>
          <SelectContent>
            {suggestions.map((m) => (
              <SelectItem key={m} value={m}>
                <span className="font-mono text-xs">{m}</span>
                {m === fallback && (
                  <span className="ml-2 text-[10px] text-muted-foreground">default</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            className="font-mono text-xs"
            value={value}
            onChange={(e) => setModel(role, e.target.value)}
            placeholder={`Custom model ID — leave empty for ${fallback}`}
          />
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModel(role, '')}
              title="Reset to default"
            >
              <Zap className="size-3.5" />
              Default
            </Button>
          )}
        </div>
      </div>
    </Field>
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
  return (
    <>
      <Section
        title="audio capture"
        hint="Microphone for your voice. System loopback captures the other speaker."
      >
        <Field label="Microphone">
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
                <SelectItem value="default">Default device</SelectItem>
                {mics.map((m) => (
                  <SelectItem key={m.deviceId} value={m.deviceId}>
                    {m.label || `device ${m.deviceId.slice(0, 8)}…`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              title="Re-scan and request mic permission"
              onClick={onRescan}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          {micsError && <p className="mt-2 text-xs text-destructive">{micsError}</p>}
        </Field>
        <Row
          label="Capture system audio"
          hint="Loopback the other side of the call automatically."
        >
          <Switch
            checked={settings.audio.systemEnabled}
            onCheckedChange={(v) => update('audio', { ...settings.audio, systemEnabled: v })}
          />
        </Row>
        <Row
          label="Skip silence on mic (VAD)"
          hint="Drop pure-silence batches from the MIC channel before sending to STT. Saves bandwidth on quiet sessions. Never applied to system audio (the other speaker's loopback is left alone). Takes effect on next session start."
        >
          <Switch
            checked={settings.audio.vadEnabled}
            onCheckedChange={(v) => update('audio', { ...settings.audio, vadEnabled: v })}
          />
        </Row>
      </Section>

      <TranscriptionLanguageSection settings={settings} update={update} />
    </>
  )
}

const TRANSCRIPTION_LANGUAGES_POPULAR: Array<{ value: string; flag: string; label: string }> = [
  { value: 'multi', flag: '🌐', label: 'Multilingual · auto-switch' },
  { value: 'en', flag: '🇬🇧', label: 'English' },
  { value: 'ru', flag: '🇷🇺', label: 'Russian · Русский' },
  { value: 'es', flag: '🇪🇸', label: 'Spanish · Español' },
  { value: 'de', flag: '🇩🇪', label: 'German · Deutsch' },
  { value: 'fr', flag: '🇫🇷', label: 'French · Français' }
]

const TRANSCRIPTION_LANGUAGES_OTHER: Array<{ value: string; flag: string; label: string }> = [
  { value: 'it', flag: '🇮🇹', label: 'Italian · Italiano' },
  { value: 'pt', flag: '🇵🇹', label: 'Portuguese · Português' },
  { value: 'nl', flag: '🇳🇱', label: 'Dutch · Nederlands' },
  { value: 'pl', flag: '🇵🇱', label: 'Polish · Polski' },
  { value: 'tr', flag: '🇹🇷', label: 'Turkish · Türkçe' },
  { value: 'uk', flag: '🇺🇦', label: 'Ukrainian · Українська' },
  { value: 'ja', flag: '🇯🇵', label: 'Japanese · 日本語' },
  { value: 'ko', flag: '🇰🇷', label: 'Korean · 한국어' },
  { value: 'zh', flag: '🇨🇳', label: 'Chinese · 中文' },
  { value: 'hi', flag: '🇮🇳', label: 'Hindi · हिन्दी' },
  { value: 'ar', flag: '🇸🇦', label: 'Arabic · العربية' }
]

function TranscriptionLanguageSection({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  // Different STT providers handle 'multi' differently — Deepgram has native
  // multilingual streaming, the others do per-utterance language detection or
  // require a single locked language. The hint changes accordingly so the
  // user knows what to expect for THEIR provider.
  const provider = settings.sttProvider
  const supportsMulti = provider === 'deepgram' || provider === 'openai-whisper'
  const showFlag = (v: string) =>
    [...TRANSCRIPTION_LANGUAGES_POPULAR, ...TRANSCRIPTION_LANGUAGES_OTHER].find((l) => l.value === v)

  const current = showFlag(settings.transcriptionLanguage)
  return (
    <Section
      title="transcription language"
      hint={
        supportsMulti
          ? `Pick "Multilingual" for code-switching, or pin a specific language for sharper accuracy. Provider: ${provider}.`
          : `Provider "${provider}" works best with a single locked language. Pick the one most of your speech is in.`
      }
    >
      <Field label="Language">
        <Select
          value={settings.transcriptionLanguage}
          onValueChange={(v) => update('transcriptionLanguage', v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {current ? `${current.flag}  ${current.label}` : settings.transcriptionLanguage}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Popular
            </div>
            {TRANSCRIPTION_LANGUAGES_POPULAR.filter(
              (l) => l.value !== 'multi' || supportsMulti
            ).map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="mr-2">{l.flag}</span>
                {l.label}
              </SelectItem>
            ))}
            <div className="mt-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Other
            </div>
            {TRANSCRIPTION_LANGUAGES_OTHER.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                <span className="mr-2">{l.flag}</span>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="text-[11px] text-muted-foreground">
        Switch STT provider in the <span className="font-mono">Providers</span> tab.
      </p>
    </Section>
  )
}

function PersonaTab({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  return (
    <>
      <Section
        title="assistant persona"
        hint="Goes into the model's system instruction — tells the AI WHO you are."
      >
        <Field label="Preset">
          <div className="flex items-center gap-2">
            <Select
              value=""
              onValueChange={(id) => {
                const preset = PERSONA_PRESETS.find((p) => p.id === id)
                if (preset) update('assistantPersona', preset.prompt)
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Pick a preset…" />
              </SelectTrigger>
              <SelectContent>
                {PERSONA_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {settings.assistantPersona && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update('assistantPersona', '')}
              >
                Clear
              </Button>
            )}
          </div>
        </Field>
        <div>
          <Textarea
            rows={5}
            value={settings.assistantPersona}
            onChange={(e) => update('assistantPersona', e.target.value)}
            placeholder="e.g. I am a senior React developer interviewing at a FAANG company. Help me answer at senior level with concrete trade-offs."
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Tip: edit any preset after picking it. Persona is fixed for the whole session.
          </p>
        </div>
      </Section>

      <Section
        title="response language"
        hint="What language Zanban replies in. Useful for screenshots — they often have English text but you want a Russian explanation."
      >
        <Field label="Reply language">
          <Select
            value={settings.responseLanguage}
            onValueChange={(v) => update('responseLanguage', v as ResponseLanguage)}
          >
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
        </Field>
      </Section>

      <Section
        title="meeting context"
        hint="Situational details for THIS meeting — pasted as a context block in every prompt."
      >
        <Textarea
          rows={5}
          value={settings.meetingContext}
          onChange={(e) => update('meetingContext', e.target.value)}
          placeholder="Job description, your resume, what you're trying to learn from this call…"
        />
      </Section>
    </>
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
  const allDefault = (
    Object.keys(settings.hotkeys) as Array<keyof AppSettings['hotkeys']>
  ).every((k) => settings.hotkeys[k] === DEFAULT_SETTINGS.hotkeys[k])

  return (
    <Section
      title="hotkeys"
      hint="Global accelerators. Click a binding to rebind — press Esc to cancel, ⌫ to clear."
    >
      <div className="flex flex-col gap-2">
        {(Object.keys(settings.hotkeys) as Array<keyof AppSettings['hotkeys']>).map((k) => (
          <Field key={k} label={hotkeyLabel(k)} hint={hotkeyHint(k)}>
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
            Reset all to defaults
          </Button>
        </div>
      )}
    </Section>
  )
}

function hotkeyHint(k: string): string {
  switch (k) {
    case 'toggleOverlay':
      return 'Show or hide the floating assistant.'
    case 'askAi':
      return 'Focus the Ask input from anywhere.'
    case 'answerLast':
      return 'Answer the last detected question with one keypress.'
    case 'hideShow':
      return 'Toggle stealth — hides from screen-share.'
    case 'screenshot':
      return 'Capture full screen, OCR it, attach to next Ask.'
    case 'cropper':
      return 'Drag a region, OCR only that area, attach to next Ask.'
    case 'chat':
      return 'Open the standalone chat window (no transcript context).'
    default:
      return ''
  }
}

function AboutTab({ version }: { version: string }) {
  return (
    <Section title="about">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-baseline gap-2">
          <div className="text-base font-semibold">Zanban</div>
          <div className="font-mono text-[11px] text-muted-foreground">v{version || '…'}</div>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Desktop AI meeting assistant. Real-time transcription via Google STT, answers via Vercel
          AI Gateway. Sessions stored locally.
        </p>
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

function OpacityField({
  value,
  onChange
}: {
  value: number
  onChange(v: number): void
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4">
      <div className="pt-1.5">
        <div className="text-[13px] text-foreground/85">Interface opacity</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Blend the floating overlay into the screen background. Useful when a
          meeting tile is bright. 100% = solid.
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
  // Preview canvas: a faked desktop tile with the overlay's actual chrome
  // floating on top at the chosen opacity. Updates live as the user drags
  // the slider so they don't have to alt-tab to the overlay to judge it.
  const clamped = Math.min(1, Math.max(0.4, opacity))
  return (
    <div
      className="relative h-[150px] w-full overflow-hidden rounded-md border border-white/[0.06]"
      style={{
        // A mocked "bright meeting tile" — same gradient vocabulary the actual
        // overlay artboard uses in the design canvas.
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
      {/* The actual overlay chrome stack at the chosen opacity. Built to mirror
          OverlayApp.tsx's real status pill + answer card so any future visual
          change there is easy to mirror here. */}
      <div
        className="absolute left-1/2 top-3 -translate-x-1/2"
        style={{ opacity: clamped, transition: 'opacity 120ms ease-out' }}
      >
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2 py-0.5 backdrop-blur-md">
            {/* mark */}
            <span className="flex size-3 items-center justify-center text-foreground">
              <span className="block size-2 rounded-full bg-foreground/85 [clip-path:polygon(50%_0,100%_0,100%_100%,50%_100%)]" />
            </span>
            <span className="font-mono text-[8px] text-primary">● 02:31</span>
            <span className="font-mono text-[8px] text-muted-foreground">listening</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5">
            <span className="size-1 rounded-full bg-primary" />
            <span className="text-[8px] text-foreground">how do you handle…</span>
          </div>
          <div className="rounded-md border border-white/10 bg-black/55 px-2 py-1 backdrop-blur-md">
            <div className="font-mono text-[7px] uppercase tracking-wider text-muted-foreground/80">
              answer last
            </div>
            <div className="mt-0.5 h-0.5 w-24 rounded bg-foreground/30" />
            <div className="mt-0.5 h-0.5 w-20 rounded bg-foreground/20" />
            <div className="mt-0.5 h-0.5 w-16 rounded bg-foreground/15" />
          </div>
        </div>
      </div>
      {/* corner readout — confirms the % the user is dragging without making
          them look up at the slider's tail. */}
      <div className="absolute bottom-1.5 right-2 font-mono text-[9px] text-muted-foreground/70">
        {Math.round(clamped * 100)}% preview
      </div>
    </div>
  )
}

function OpacitySlider({
  value,
  onChange
}: {
  value: number
  onChange(v: number): void
}) {
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

async function enumerateMics(): Promise<MicDevice[]> {
  const list = await navigator.mediaDevices.enumerateDevices()
  return list
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }))
}

function hotkeyLabel(k: string): string {
  switch (k) {
    case 'toggleOverlay':
      return 'Toggle overlay'
    case 'askAi':
      return 'Focus ask'
    case 'answerLast':
      return 'Answer last'
    case 'hideShow':
      return 'Hide / show'
    case 'screenshot':
      return 'Snap full screen → Ask'
    case 'cropper':
      return 'Drag region → OCR Ask'
    case 'chat':
      return 'Open chat window'
    default:
      return k
  }
}
