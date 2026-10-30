import { useCallback, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LlmProvider, SttProvider } from '@shared/types'
import type { ProviderTestResult } from '@shared/api'
import { errorMessage } from '@renderer/lib/errors'
import { cn } from '@renderer/lib/utils'

export interface ProviderCheck {
  testing: boolean
  result: ProviderTestResult | null
  check(): Promise<void>
}

const probeLlm = (id: LlmProvider) => window.zanban.providers.testConnection(id)
const probeStt = (id: SttProvider) => window.zanban.providers.testStt(id)

/** A live probe of an LLM provider's saved credentials (a 1-token call). */
export function useProviderCheck(provider: LlmProvider): ProviderCheck {
  return useCheck(provider, probeLlm)
}

/** A free probe of a speech-recognition engine's saved credentials. */
export function useSttCheck(provider: SttProvider): ProviderCheck {
  return useCheck(provider, probeStt)
}

function useCheck<T extends string>(
  id: T,
  probe: (id: T) => Promise<ProviderTestResult>
): ProviderCheck {
  const [testing, setTesting] = useState(false)
  // Kept with the id it belongs to, so switching providers drops a stale verdict.
  const [checked, setChecked] = useState<{ id: T; result: ProviderTestResult } | null>(null)
  const latest = useRef(0)
  const check = useCallback(async () => {
    const mine = ++latest.current
    setTesting(true)
    setChecked(null)
    let result: ProviderTestResult
    try {
      result = await probe(id)
    } catch (err) {
      result = { ok: false, message: errorMessage(err) }
    }
    // A slow check that a newer one has overtaken must not overwrite it when it lands.
    if (mine !== latest.current) return
    setChecked({ id, result })
    setTesting(false)
  }, [id, probe])
  return { testing, result: checked?.id === id ? checked.result : null, check }
}

export function ProviderCheckResult({
  testing,
  result
}: {
  testing: boolean
  result: ProviderTestResult | null
}) {
  const { t } = useTranslation()
  if (testing) {
    return (
      <span className="flex items-center gap-1 text-small text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {t('settings.providers.checking')}
      </span>
    )
  }
  if (!result) return null
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1 text-small',
        result.ok ? 'text-success' : 'text-warn'
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="size-3 shrink-0" />
      ) : (
        <XCircle className="size-3 shrink-0" />
      )}
      <span className="truncate" title={result.message}>
        {result.ok
          ? t('settings.providers.test_ok')
          : result.reason === 'invalid_key'
            ? t('settings.providers.test_invalid_key')
            : t('settings.providers.test_failed', { error: result.message ?? '' })}
      </span>
    </span>
  )
}
