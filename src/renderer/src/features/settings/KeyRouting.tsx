import { createContext, useContext, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import {
  KEY_SETTINGS_FIELD,
  cleanPastedKey,
  detectKeyProvider,
  maskKey,
  type KeyProvider
} from '@renderer/lib/keyProvider'
import { llmProviderConfigured, sttProviderConfigured } from './providerStatus'

export interface KeyMover {
  isSet(provider: KeyProvider): boolean
  store(provider: KeyProvider, key: string): void
}

export const KeyMoverContext = createContext<KeyMover | null>(null)

function useKeyProviderName(): (provider: KeyProvider) => string {
  const { t } = useTranslation()
  return (provider) => {
    if (provider === 'tavily') return t('settings.providers.tavily_title')
    if (provider === 'elevenlabs') return t('settings.providers.stt.elevenlabs.name')
    return t(`settings.providers.llm.${provider}.name`)
  }
}

/**
 * Sits under a key field. When what's typed there is clearly another
 * provider's key, offers to move it; the key itself is never shown.
 */
export function MisplacedKeyHint({
  fieldKey,
  typed,
  onMoved
}: {
  /** The settings field this input saves to. */
  fieldKey: string
  typed: string
  /** Empties the input the key was moved out of. */
  onMoved(): void
}) {
  const { t } = useTranslation()
  const mover = useContext(KeyMoverContext)
  const providerName = useKeyProviderName()
  const [movedTo, setMovedTo] = useState<KeyProvider | null>(null)
  if (!mover) return null

  const detected = detectKeyProvider(typed)
  if (detected && KEY_SETTINGS_FIELD[detected] !== fieldKey) {
    const provider = providerName(detected)
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-2 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-small text-warn"
      >
        <span>
          {t(
            mover.isSet(detected)
              ? 'settings.providers.key_misplaced_replace'
              : 'settings.providers.key_misplaced',
            { provider }
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-small"
          onClick={() => {
            mover.store(detected, cleanPastedKey(typed))
            onMoved()
            setMovedTo(detected)
          }}
        >
          <ArrowRightLeft className="size-3" />
          {t('settings.providers.key_move')}
        </Button>
      </div>
    )
  }
  if (movedTo && !typed) {
    return (
      <p role="status" className="text-small text-success">
        {t('settings.providers.key_moved', { provider: providerName(movedTo) })}
      </p>
    )
  }
  return null
}

interface Activation {
  kind: 'llm' | 'stt'
  apply(): void
}

type PasteResult =
  | { kind: 'saved'; provider: KeyProvider; mask: string; activation: Activation | null }
  | { kind: 'unknown' }

/**
 * One field for any key: it's recognized by how it starts and saved where it
 * belongs. The input is emptied straight away — only the masked tail is kept.
 */
export function PasteAnyKey({
  settings,
  update
}: {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
}) {
  const { t } = useTranslation()
  const providerName = useKeyProviderName()
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<PasteResult | null>(null)

  // Offered only when the provider now in use has nothing to run on.
  function activationFor(provider: KeyProvider): Activation | null {
    if (provider === 'tavily') return null
    if (provider === 'elevenlabs') {
      if (settings.sttProvider === provider || sttProviderConfigured(settings)) return null
      return { kind: 'stt', apply: () => update('sttProvider', provider) }
    }
    if (settings.llmProvider === provider || llmProviderConfigured(settings)) return null
    return { kind: 'llm', apply: () => update('llmProvider', provider) }
  }

  function accept(raw: string): void {
    const key = cleanPastedKey(raw)
    setTyped('')
    if (!key) return
    const provider = detectKeyProvider(key)
    if (!provider) {
      setResult({ kind: 'unknown' })
      return
    }
    update(KEY_SETTINGS_FIELD[provider], key)
    setResult({ kind: 'saved', provider, mask: maskKey(key), activation: activationFor(provider) })
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="password"
        value={typed}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
        onPaste={(e) => {
          e.preventDefault()
          accept(e.clipboardData.getData('text'))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') accept(typed)
        }}
        placeholder={t('settings.providers.paste_any_placeholder')}
        aria-label={t('settings.providers.paste_any_label')}
        className="font-mono text-small"
      />
      {result?.kind === 'saved' && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-small text-success">
            <CheckCircle2 className="size-3.5 shrink-0" />
            {t('settings.providers.paste_any_saved', {
              provider: providerName(result.provider),
              mask: result.mask
            })}
          </span>
          {result.activation && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-small"
              onClick={() => {
                result.activation?.apply()
                setResult({ ...result, activation: null })
              }}
            >
              {t(
                result.activation.kind === 'stt'
                  ? 'settings.providers.paste_any_use_stt'
                  : 'settings.providers.paste_any_use_llm',
                { provider: providerName(result.provider) }
              )}
            </Button>
          )}
        </div>
      )}
      {result?.kind === 'unknown' && (
        <p role="status" className="flex items-start gap-1.5 text-small text-warn">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {t('settings.providers.paste_any_unknown')}
        </p>
      )}
    </div>
  )
}
