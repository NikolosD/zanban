import { createContext, useContext, useRef, useState } from 'react'
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
import { cn } from '@renderer/lib/utils'
import { llmProviderConfigured, sttProviderConfigured } from './providerStatus'

type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

export interface KeyMover {
  isSet(provider: KeyProvider): boolean
  store(provider: KeyProvider, key: string): void
  /** Changes each time `store` writes to this field. */
  revision(field: keyof AppSettings): number
}

export const KeyMoverContext = createContext<KeyMover | null>(null)

/**
 * Keys saved from outside a field go through `store`, which also bumps that
 * field's revision. A field still showing what was typed there earlier would
 * otherwise act on a key that is no longer the saved one.
 */
export function useKeyMover(settings: AppSettings, update: UpdateSetting): KeyMover {
  const [revisions, setRevisions] = useState<Partial<Record<keyof AppSettings, number>>>({})
  return {
    isSet: (provider) => !!settings[KEY_SETTINGS_FIELD[provider]],
    store: (provider, key) => {
      const field = KEY_SETTINGS_FIELD[provider]
      update(field, key)
      setRevisions((current) => ({ ...current, [field]: (current[field] ?? 0) + 1 }))
    },
    revision: (field) => revisions[field] ?? 0
  }
}

export function useFieldRevision(field: keyof AppSettings | undefined): number {
  const mover = useContext(KeyMoverContext)
  return field && mover ? mover.revision(field) : 0
}

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
 * provider's key, offers to move it; the key itself is never shown. The live
 * region stays in the page while empty so a screen reader announces what it
 * gets, and the button stays outside it.
 */
export function MisplacedKeyHint({
  fieldKey,
  typed,
  onMoved
}: {
  /** The settings field this input saves to. */
  fieldKey: keyof AppSettings
  typed: string
  /** Empties the input the key was moved out of and puts focus back in it. */
  onMoved(): void
}) {
  const { t } = useTranslation()
  const mover = useContext(KeyMoverContext)
  const providerName = useKeyProviderName()
  const [movedTo, setMovedTo] = useState<KeyProvider | null>(null)
  if (!mover) return null

  const found = detectKeyProvider(typed)
  const misplaced = found && KEY_SETTINGS_FIELD[found] !== fieldKey ? found : null
  const confirmed = !misplaced && !typed ? movedTo : null
  const message = misplaced
    ? t(
        mover.isSet(misplaced)
          ? 'settings.providers.key_misplaced_replace'
          : 'settings.providers.key_misplaced',
        { provider: providerName(misplaced) }
      )
    : confirmed
      ? t('settings.providers.key_moved', { provider: providerName(confirmed) })
      : ''

  return (
    <div
      className={cn(
        misplaced &&
          'flex items-center justify-between gap-2 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-small text-warn',
        confirmed && 'text-small text-success',
        !message && 'sr-only'
      )}
    >
      <span role="status" aria-live="polite">
        {message}
      </span>
      {misplaced && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-small"
          aria-label={t('settings.providers.key_move_to', { provider: providerName(misplaced) })}
          onClick={() => {
            mover.store(misplaced, cleanPastedKey(typed))
            setMovedTo(misplaced)
            onMoved()
          }}
        >
          <ArrowRightLeft className="size-3" />
          {t('settings.providers.key_move')}
        </Button>
      )}
    </div>
  )
}

interface Activation {
  kind: 'llm' | 'stt'
  apply(): void
}

type PasteResult =
  | {
      kind: 'saved'
      provider: KeyProvider
      replaced: boolean
      mask: string
      activation: Activation | null
    }
  | { kind: 'unknown' }

/**
 * One field for any key: it's recognized by how it starts and saved where it
 * belongs. The input is emptied straight away — only the masked tail is kept.
 */
export function PasteAnyKey({
  settings,
  update,
  mover
}: {
  settings: AppSettings
  update: UpdateSetting
  mover: KeyMover
}) {
  const { t } = useTranslation()
  const providerName = useKeyProviderName()
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<PasteResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    const replaced = mover.isSet(provider)
    mover.store(provider, key)
    setResult({
      kind: 'saved',
      provider,
      replaced,
      mask: maskKey(key),
      activation: activationFor(provider)
    })
  }

  const saved = result?.kind === 'saved' ? result : null
  const activation = saved?.activation ?? null
  const message = saved
    ? t(
        saved.replaced
          ? 'settings.providers.paste_any_replaced'
          : 'settings.providers.paste_any_saved',
        { provider: providerName(saved.provider), mask: saved.mask }
      )
    : result
      ? t('settings.providers.paste_any_unknown')
      : ''

  return (
    <div className="flex flex-col gap-2">
      <Input
        ref={inputRef}
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
      <div className={cn(message ? 'flex flex-wrap items-center gap-x-3 gap-y-1.5' : 'sr-only')}>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-start gap-1.5 text-small',
            saved ? 'text-success' : 'text-warn'
          )}
        >
          {saved && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
          {result?.kind === 'unknown' && <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
          {message}
        </p>
        {saved && activation && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-small"
            onClick={() => {
              activation.apply()
              setResult({ ...saved, activation: null })
              inputRef.current?.focus()
            }}
          >
            {t(
              activation.kind === 'stt'
                ? 'settings.providers.paste_any_use_stt'
                : 'settings.providers.paste_any_use_llm',
              { provider: providerName(saved.provider) }
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
