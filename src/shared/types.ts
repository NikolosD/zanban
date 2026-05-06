export type AudioChannel = 'mic' | 'system'

export type ReferenceDocKind = 'pdf' | 'docx' | 'txt' | 'md'

export interface ReferenceDoc {
  id: string
  name: string
  kind: ReferenceDocKind
  bytes: number
  /** Plain text extracted from the source. Stored as-is (utf-8). */
  text: string
  /** Whether this doc participates in the next LLM prompt. */
  active: boolean
  addedAt: number
}

export interface SessionExportPayload {
  title: string
  startedAt: number
  /** Pre-rendered transcript and Q&A blocks, in display order. */
  blocks: Array<
    | { kind: 'transcript'; speaker: string; text: string; ts: number }
    | { kind: 'qa'; question: string; answer: string; ts: number }
    | { kind: 'note'; text: string; ts: number }
  >
}

export interface TranscriptSegment {
  id: string
  channel: AudioChannel
  speaker: number
  startMs: number
  endMs: number
  text: string
  isFinal: boolean
  createdAt: number
}

export type TranscriptionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting'; channel: AudioChannel }
  | { kind: 'open'; channel: AudioChannel }
  | { kind: 'closed'; channel: AudioChannel; reason?: string }
  | { kind: 'error'; channel: AudioChannel; message: string }

export type SessionState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; sessionId: string; startedAt: number }
  | { kind: 'stopping' }

export interface AiAskInput {
  prompt: string
  contextSeconds?: number
  /**
   * Optional base64 data URL (data:image/png;base64,…). When present, the
   * gateway switches to a vision-capable model and includes the image as a
   * content part alongside the user prompt.
   */
  imageDataUrl?: string
  /**
   * Optional OCR text extracted from `imageDataUrl`. When present, the prompt
   * builder appends it as `<screen_ocr>` so even non-vision models get the
   * textual content of the screenshot.
   */
  ocrText?: string
  /**
   * Override the model for THIS request only. Falls through every layer
   * (provider abstraction, persona default, settings default).
   */
  modelOverride?: string
}

export interface ScreenSnapshot {
  dataUrl: string
  ocrText: string | null
}

export interface AiChunk {
  requestId: string
  text: string
}

export interface AiDone {
  requestId: string
  finishReason?: string
}

export interface AiError {
  requestId: string
  message: string
}

export type SttProvider = 'google' | 'deepgram' | 'elevenlabs' | 'openai-whisper' | 'local-whisper'

export const STT_PROVIDERS: Array<{
  value: SttProvider
  label: string
  hint: string
}> = [
  {
    value: 'deepgram',
    label: 'Deepgram',
    hint: 'Nova-3 streaming. Single API key, low latency, recommended default.'
  },
  {
    value: 'google',
    label: 'Google Speech-to-Text',
    hint: 'Chirp 3 multilingual streaming. Needs a GCP project + ADC or service account.'
  },
  {
    value: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'Streaming STT via @elevenlabs/elevenlabs-js. Wire-up pending.'
  },
  {
    value: 'openai-whisper',
    label: 'OpenAI Whisper (cloud)',
    hint: 'Whisper-large via OpenAI Realtime / batch API. Wire-up pending.'
  },
  {
    value: 'local-whisper',
    label: 'Local Whisper (Privacy Mode)',
    hint: 'Whisper-tiny via @xenova/transformers, on-device. Slower, lower quality.'
  }
]

export type AiRole = 'fast' | 'filter' | 'summary' | 'vision'

/**
 * IDs for the LLM providers Zanban can talk to. Single source of truth — used
 * in settings, model catalogues, and the main-process provider registry.
 */
export type LlmProvider =
  | 'vercel-gateway'
  | 'anthropic'
  | 'openai'
  | 'google-gemini'
  | 'groq'
  | 'ollama'

export interface AiModelSettings {
  /** Streaming answers (Ask hotkey, Answer last). Empty string = use default. */
  fast: string
  /** Cheap classifier for "is this a question from the other speaker?" */
  filter: string
  /** Session-end title generation. */
  summary: string
  /** Vision-capable model for screenshot Asks. */
  vision: string
}

export interface AppSettings {
  /**
   * Which STT backend to use. Each provider needs its own credentials below.
   */
  sttProvider: SttProvider
  /**
   * Google Cloud project ID — required for v2 STT to build the recognizer
   * path (`projects/{id}/locations/global/recognizers/_`). When using ADC
   * (gcloud auth application-default login) the SDK can also infer this, but
   * we always pass it explicitly to avoid surprises.
   */
  googleProjectId: string | null
  /**
   * Optional service-account JSON. If empty we fall back to Application
   * Default Credentials (run `gcloud auth application-default login` once).
   * Many orgs block creating user-managed JSON keys, so ADC is the preferred
   * path on a personal machine.
   */
  googleServiceAccountJson: string | null
  /**
   * Deepgram API key. Used when `sttProvider === 'deepgram'`. Encrypted at
   * rest via OS keychain.
   */
  deepgramApiKey: string | null
  vercelApiKey: string | null
  /** Which LLM provider drives `ai.ask`. Default: 'vercel-gateway'. */
  llmProvider: LlmProvider
  /**
   * Optional override: when set, ai.ask requests that include an image are
   * routed through this provider instead of `llmProvider`. Useful when the
   * user wants a fast/cheap text provider but a stronger vision model from
   * a different vendor (e.g. Vercel for text, Google Gemini for image).
   * `null` falls back to `llmProvider`.
   */
  visionProvider: LlmProvider | null
  anthropicApiKey: string | null
  openaiApiKey: string | null
  googleAiApiKey: string | null
  groqApiKey: string | null
  elevenlabsApiKey: string | null
  tavilyApiKey: string | null
  /** Local Ollama HTTP host. Empty = http://127.0.0.1:11434. */
  ollamaHost: string
  /**
   * Ordered list of providers to try when the active LLM call fails before
   * any chunks have been streamed. Empty = no fallback (current behavior).
   * Listed providers are tried in order; a provider whose key is missing is
   * skipped silently. The fallback never kicks in mid-stream — once the user
   * has seen partial text, errors bubble up rather than silently rerouting
   * to a different model that would produce a totally different answer.
   */
  llmFallbackOrder: LlmProvider[]
  /** Privacy Mode toggle (Phase 5.6) — flips active LLM/STT/embeddings to local. */
  privacyMode: boolean
  /** Auto-augment AI prompts with Tavily web search results when the query
   *  looks like a factual lookup (≥4 words). Requires `tavilyApiKey`. */
  autoWebSearch: boolean
  /**
   * Per-role model IDs **per provider**. Empty string in any slot means
   * "use the provider's default" — see PROVIDER_MODEL_DEFAULTS. Switching
   * providers automatically swaps which set of model IDs is in effect, so
   * the user doesn't have to re-type `claude-haiku-4-5` after picking
   * Anthropic, etc.
   */
  aiModels: Partial<Record<LlmProvider, AiModelSettings>>
  transcriptionLanguage: string
  contextSeconds: number
  meetingContext: string
  /**
   * Free-form persona text — kept for backwards compatibility. The new
   * persona system (activePersonaId + Persona store) supersedes this. When
   * `activePersonaId` is set, the active persona's systemPrompt wins.
   */
  assistantPersona: string
  /** ID of the currently active persona, or null when using free-form `assistantPersona`. */
  activePersonaId: string | null
  /**
   * Language the assistant should respond in.
   * 'auto' = match the question / transcript / screenshot.
   * Specific code (e.g. 'ru', 'en') = always use that language.
   */
  responseLanguage: ResponseLanguage
  /**
   * When true the overlay is visible to screen-share / recording. When false
   * (default) the overlay sets `setContentProtection(true)` so it stays hidden
   * from outside viewers but is still visible on this user's screen.
   */
  detectable: boolean
  /**
   * When stealth (Hide) is on, also collapse the overlay to just the status
   * pill — chips, input, and answer pane disappear. Useful if you don't want
   * the floating widget visible at all while hidden.
   */
  hideWidgetWhenHidden: boolean
  /**
   * Hide Zanban from the OS app-switcher and dock/taskbar entirely. macOS:
   * `app.dock.hide()` (also drops the app from Cmd+Tab). Windows/Linux:
   * `setSkipTaskbar(true)` on every window so it doesn't appear in the
   * taskbar or Alt+Tab. Requires restart on macOS for the dock change.
   */
  hideFromAppSwitcher: boolean
  /**
   * Overall opacity of the overlay window in [0.4, 1]. Lets the user blend
   * the HUD into the screen background — useful in glance-only mode or when
   * a meeting tile is bright. Applied via BrowserWindow.setOpacity.
   */
  overlayOpacity: number
  autoDetectQuestions: boolean
  hotkeys: {
    toggleOverlay: string
    askAi: string
    answerLast: string
    hideShow: string
    screenshot: string
    cropper: string
    chat: string
    /** Force-shows the dashboard window. Survives stealth+hideWidget mode
     *  (where the dashboard is removed from Alt+Tab/taskbar and would
     *  otherwise be unrecoverable without re-launching the app). */
    showDashboard: string
  }
  audio: {
    micDeviceId: string | null
    systemEnabled: boolean
    /**
     * Skip sending pure-silence batches to the STT provider on the **mic**
     * channel only. Cuts streaming bandwidth during long pauses without
     * clipping speech (short hangover keeps the tail of every utterance).
     * The system-audio (loopback) channel is never VAD-gated — quiet bleeps
     * and the other speaker's voice through Zoom would get dropped.
     */
    vadEnabled: boolean
    /** RMS threshold in [0,1] for the energy-gated VAD. Default 0.005 ≈ -46 dBFS — quiet but real speech still passes. */
    vadThreshold: number
  }
  /**
   * True once the user has finished (or explicitly skipped) the first-run
   * onboarding wizard. Until this flips, the dashboard mounts the wizard on
   * top of itself so a brand-new user can't get stuck on a blank "no sessions
   * yet" screen without knowing they need API keys.
   */
  onboardingCompleted: boolean
  /**
   * UI language. Independent of `responseLanguage` (which the LLM sees) so
   * the user can have a Russian UI but still ask the assistant in English,
   * or vice versa. Used by the i18n provider once it lands; today it just
   * persists the preference picked during onboarding.
   */
  uiLocale: 'en' | 'ru'
}

export type ResponseLanguage =
  | 'auto'
  | 'en'
  | 'ru'
  | 'es'
  | 'de'
  | 'fr'
  | 'it'
  | 'pt'
  | 'ja'
  | 'ko'
  | 'zh'

export const RESPONSE_LANGUAGES: Array<{ value: ResponseLanguage; label: string }> = [
  { value: 'auto', label: 'Auto · match the question' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Russian · Русский' },
  { value: 'es', label: 'Spanish · Español' },
  { value: 'de', label: 'German · Deutsch' },
  { value: 'fr', label: 'French · Français' },
  { value: 'it', label: 'Italian · Italiano' },
  { value: 'pt', label: 'Portuguese · Português' },
  { value: 'ja', label: 'Japanese · 日本語' },
  { value: 'ko', label: 'Korean · 한국어' },
  { value: 'zh', label: 'Chinese · 中文' }
]

/**
 * Default model IDs per role, **per LLM provider**. When the user switches
 * providers in Settings → Providers, the Models tab automatically picks up
 * the right defaults — they don't have to retype `claude-haiku-4-5` after
 * picking Anthropic. Custom overrides live alongside (see `providerModels`)
 * and win when set.
 */
export const PROVIDER_MODEL_DEFAULTS: Record<LlmProvider, AiModelSettings> = {
  'vercel-gateway': {
    fast: 'openai/gpt-oss-120b',
    // gpt-oss-20b: 0.1s TTFT, 252 tps, $0.07 in / $0.30 out per 1M.
    // Replaces the slower deepseek/deepseek-v4-flash for the question
    // detector — filter runs on every utterance so TTFT matters.
    filter: 'openai/gpt-oss-20b',
    summary: 'xiaomi/mimo-v2.5',
    // gemini-2.5-flash-lite: GA, 244 tps, 1M context, $0.10 in / $0.40 out.
    // We dropped the 3.1-flash-lite-preview default because the preview tier
    // was noticeably slower in real use — likely smaller deployment fleet.
    vision: 'google/gemini-2.5-flash-lite'
  },
  anthropic: {
    fast: 'claude-haiku-4-5',
    filter: 'claude-haiku-4-5',
    summary: 'claude-haiku-4-5',
    vision: 'claude-sonnet-4-6'
  },
  openai: {
    fast: 'gpt-5.4-mini',
    filter: 'gpt-5.4-nano',
    summary: 'gpt-5.4-mini',
    vision: 'gpt-5.4'
  },
  'google-gemini': {
    fast: 'gemini-2.5-flash-lite',
    filter: 'gemini-2.5-flash-lite',
    summary: 'gemini-2.5-flash-lite',
    vision: 'gemini-2.5-flash-lite'
  },
  groq: {
    fast: 'llama-3.3-70b-versatile',
    filter: 'gemma2-9b-it',
    summary: 'llama-3.3-70b-versatile',
    vision: 'llama-3.2-90b-vision-preview'
  },
  ollama: {
    fast: 'llama3.1:8b',
    filter: 'llama3.1:8b',
    summary: 'llama3.1:8b',
    vision: 'llava:7b'
  }
}

/**
 * Legacy alias — kept so any old import path doesn't break. Refers to the
 * Vercel Gateway defaults (the project's original LLM router).
 */
export const DEFAULT_AI_MODELS: AiModelSettings = PROVIDER_MODEL_DEFAULTS['vercel-gateway']

/**
 * Curated per-provider model lists for the overlay's model-override picker
 * and any other UI that needs to suggest valid IDs for the *currently active*
 * provider. Each list is what the picker shows when that provider is selected
 * — so the user doesn't see "openai/gpt-oss-120b" while talking to Anthropic.
 */
export const PROVIDER_FAST_MODELS: Record<LlmProvider, string[]> = {
  'vercel-gateway': [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'openai/gpt-5.4-mini',
    'anthropic/claude-haiku-4-5',
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-v4',
    'xai/grok-4-fast'
  ],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-oss-120b',
    'gpt-oss-20b',
    'o4-mini',
    'o3'
  ],
  'google-gemini': ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  groq: ['llama-3.3-70b-versatile', 'llama-4-scout', 'mixtral-8x7b-instruct', 'gemma2-9b-it'],
  ollama: ['llama3.1:8b', 'llama3.1:70b', 'qwen2.5:7b', 'qwen2.5:14b', 'mistral:7b', 'gemma3:9b']
}

export const PROVIDER_VISION_MODELS: Record<LlmProvider, string[]> = {
  'vercel-gateway': [
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4-6'
  ],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'],
  openai: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-oss-120b'],
  'google-gemini': ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  groq: ['llama-3.2-90b-vision-preview'],
  ollama: ['llava:7b', 'llava:13b', 'llama3.2-vision:11b']
}

/**
 * Curated suggestions for each role's dropdown — covers a fast/cheap default,
 * a stronger reasoning option, and a few popular alternatives. Users can also
 * type any Gateway model ID free-form.
 */
export const AI_MODEL_SUGGESTIONS: Record<AiRole, string[]> = {
  fast: [
    'openai/gpt-oss-120b',
    'openai/gpt-5.4-mini',
    'anthropic/claude-haiku-4-5',
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'deepseek/deepseek-v4',
    'xai/grok-4-fast'
  ],
  filter: [
    'openai/gpt-oss-20b',
    'arcee-ai/trinity-mini',
    'google/gemini-2.5-flash-lite',
    'mistral/ministral-3b',
    'amazon/nova-lite',
    'meta/llama-4-scout',
    'zai/glm-4.7-flashx',
    'openai/gpt-5.4-nano',
    'anthropic/claude-haiku-4-5'
  ],
  summary: [
    'xiaomi/mimo-v2.5',
    'openai/gpt-5.4-mini',
    'google/gemini-2.5-flash-lite',
    'anthropic/claude-haiku-4-5'
  ],
  vision: [
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4-6'
  ]
}

export const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: 'deepgram',
  googleProjectId: null,
  googleServiceAccountJson: null,
  deepgramApiKey: null,
  vercelApiKey: null,
  llmProvider: 'vercel-gateway',
  visionProvider: null,
  anthropicApiKey: null,
  openaiApiKey: null,
  googleAiApiKey: null,
  groqApiKey: null,
  elevenlabsApiKey: null,
  tavilyApiKey: null,
  ollamaHost: '',
  llmFallbackOrder: [],
  privacyMode: false,
  autoWebSearch: false,
  aiModels: {},
  transcriptionLanguage: 'multi',
  contextSeconds: 120,
  meetingContext: '',
  assistantPersona: '',
  activePersonaId: null,
  responseLanguage: 'auto',
  detectable: false,
  hideWidgetWhenHidden: false,
  hideFromAppSwitcher: false,
  overlayOpacity: 1,
  autoDetectQuestions: true,
  hotkeys: {
    toggleOverlay: 'Control+\\',
    askAi: 'Control+Shift+Space',
    answerLast: 'Control+Shift+Return',
    hideShow: 'Control+Shift+H',
    screenshot: 'Control+Shift+S',
    cropper: 'Control+Shift+Alt+S',
    chat: 'Control+Shift+G',
    showDashboard: 'Control+Shift+D'
  },
  audio: {
    micDeviceId: null,
    systemEnabled: true,
    vadEnabled: false,
    vadThreshold: 0.005
  },
  onboardingCompleted: false,
  uiLocale: 'en'
}

/**
 * A reusable assistant role (system prompt + per-role overrides). Shipped
 * "built-ins" can be edited or deleted just like user-created ones — the
 * `builtin` flag is informational only.
 */
export interface Persona {
  id: string
  name: string
  systemPrompt: string
  /** Optional override for the `fast` model in this persona. Empty = inherit. */
  defaultModel?: string
  /** Optional override for response language in this persona. */
  responseLanguage?: ResponseLanguage
  /** RAG retrieval tuning per persona. Defaults: useRag=true, topK=6, distance=1.2. */
  ragStrategy?: {
    useRag: boolean
    topK: number
    /** Max L2 distance — looser threshold = more snippets included. */
    distanceThreshold: number
  }
  builtin: boolean
  createdAt: number
}

export interface PersonaPreset {
  id: string
  label: string
  prompt: string
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'swe-interview-candidate',
    label: 'Software engineer · interview candidate',
    prompt:
      "I am a software engineer being interviewed for a role. Help me answer technical questions concisely and confidently, at senior level. Prefer concrete examples over generic theory. When relevant, mention trade-offs. Don't overshoot — match the depth of what was asked."
  },
  {
    id: 'swe-interviewer',
    label: 'Tech interviewer · evaluating a candidate',
    prompt:
      'I am the interviewer running a technical interview. Help me probe deeper, suggest follow-up questions, evaluate the strength of the candidate answer, and flag missing concepts. Be terse — short prompts I can use mid-conversation.'
  },
  {
    id: 'frontend-react',
    label: 'Senior frontend / React developer',
    prompt:
      'I am a senior frontend engineer specializing in React, TypeScript, and modern web tooling (Vite, Next.js, Tailwind). Answer at senior level. Reference real APIs and trade-offs.'
  },
  {
    id: 'backend-systems',
    label: 'Senior backend / systems engineer',
    prompt:
      'I am a senior backend engineer working with Go, Postgres, distributed systems, and high-throughput pipelines. Match that level — quantitative answers, concurrency considerations, real trade-offs.'
  },
  {
    id: 'product-manager',
    label: 'Product manager · stakeholder meeting',
    prompt:
      'I am a product manager talking to stakeholders. Help me reframe questions in terms of user value, scope, risk, and timeline. Avoid implementation jargon. Crisp business framing.'
  },
  {
    id: 'sales-discovery',
    label: 'Sales · discovery call',
    prompt:
      'I am a sales rep on a discovery call with a prospect. Help me ask better qualifying questions, surface the prospect pain, and match it to product capability. Suggest concrete follow-up questions.'
  }
]
