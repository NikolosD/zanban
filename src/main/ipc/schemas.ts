import { extname, isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  PROVIDER_MODEL_DEFAULTS,
  RESPONSE_LANGUAGES,
  STT_PROVIDERS,
  type AppSettings,
  type LlmProvider
} from '../../shared/types.js'
import { isValidOllamaHost } from '../../shared/settingsBoundary.js'

function oneOf<T extends string>(values: T[]): z.ZodEnum<[T, ...T[]]> {
  return z.enum(values as [T, ...T[]])
}

export const llmProvider = oneOf(Object.keys(PROVIDER_MODEL_DEFAULTS) as LlmProvider[])
const sttProvider = oneOf(STT_PROVIDERS.map((p) => p.value))
const responseLanguage = oneOf(RESPONSE_LANGUAGES.map((l) => l.value))
const secret = z.string().nullable()
const amount = z.number().finite().nonnegative()
const fraction = z.number().min(0).max(1)
// Entries saved by older builds can lack a role; empty means "provider default".
const modelSlot = z.string().default('')

const hotkeys = {
  toggleSession: z.string(),
  toggleOverlay: z.string(),
  askAi: z.string(),
  answerLast: z.string(),
  hideShow: z.string(),
  screenshot: z.string(),
  screenshotAnswer: z.string(),
  cropper: z.string(),
  chat: z.string(),
  showDashboard: z.string()
} satisfies Record<keyof AppSettings['hotkeys'], z.ZodTypeAny>

const settingsShape = {
  sttProvider,
  googleProjectId: z.string().nullable(),
  googleServiceAccountJson: secret,
  deepgramApiKey: secret,
  vercelApiKey: secret,
  llmProvider,
  visionProvider: llmProvider.nullable(),
  anthropicApiKey: secret,
  openaiApiKey: secret,
  googleAiApiKey: secret,
  groqApiKey: secret,
  elevenlabsApiKey: secret,
  tavilyApiKey: secret,
  ollamaHost: z.string().refine(isValidOllamaHost, 'ollamaHost must be an http(s) URL or empty'),
  llmFallbackOrder: z.array(llmProvider),
  privacyMode: z.boolean(),
  privacyModeSnapshot: z.object({ llmProvider, sttProvider }).nullable(),
  privacyCloudFallback: z.boolean(),
  autoWebSearch: z.boolean(),
  detailedAnswers: z.boolean(),
  autoAnswer: z.boolean(),
  aiModels: z.record(
    llmProvider,
    z.object({ fast: modelSlot, filter: modelSlot, summary: modelSlot, vision: modelSlot })
  ),
  transcriptionLanguage: z.string(),
  contextSeconds: amount,
  meetingContext: z.string(),
  assistantPersona: z.string(),
  activePersonaId: z.string().nullable(),
  responseLanguage,
  detectable: z.boolean(),
  hideWidgetWhenHidden: z.boolean(),
  hideFromAppSwitcher: z.boolean(),
  overlayOpacity: fraction,
  overlayAnswerMaxHeight: amount,
  overlayWidth: amount,
  overlayPosition: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  recap: z.object({
    autoGenerate: z.boolean(),
    tone: z.enum(['concise', 'friendly', 'formal']),
    language: z.enum(['auto', 'en', 'ru']),
    modelOverride: z.string().nullable()
  }),
  hotkeys: z.object(hotkeys),
  audio: z.object({
    micDeviceId: z.string().nullable(),
    systemEnabled: z.boolean(),
    vadEnabled: z.boolean(),
    vadThreshold: fraction
  }),
  onboardingCompleted: z.boolean(),
  uiLocale: z.enum(['en', 'ru'])
} satisfies Record<keyof AppSettings, z.ZodTypeAny>

export const settingsPatchSchema = z.object(settingsShape).partial().strict()

export const aiAskInputSchema = z.object({
  requestId: z.string().min(1),
  prompt: z.string(),
  contextSeconds: amount.optional(),
  imageDataUrl: z.string().startsWith('data:image/').optional(),
  ocrText: z.string().optional(),
  modelOverride: z.string().optional(),
  continueFrom: z.string().min(1).optional(),
  skipRetrieval: z.boolean().optional()
})

export const aiFollowUpsInputSchema = z.object({ question: z.string(), answer: z.string() })

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.md', '.txt'])
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

export const documentPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(isAbsolute, 'path must be absolute')
  .refine((p) => DOCUMENT_EXTENSIONS.has(extname(p).toLowerCase()), 'unsupported file type')

const personaFields = {
  name: z.string(),
  systemPrompt: z.string(),
  defaultModel: z.string().optional(),
  responseLanguage: responseLanguage.optional(),
  ragStrategy: z
    .object({
      useRag: z.boolean(),
      topK: z.number().int().positive(),
      distanceThreshold: amount
    })
    .optional()
}

export const personaInputSchema = z.object(personaFields)
export const personaPatchSchema = z.object(personaFields).partial()
export const importedPersonaSchema = z.object({ id: z.string().optional(), ...personaFields })
