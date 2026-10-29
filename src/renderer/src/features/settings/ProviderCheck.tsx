import { useCallback, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LlmProvider } from '@shared/types'
import type { ProviderTestResult } from '@shared/api'
import { errorMessage } from '@renderer/lib/errors'
import { cn } from '@renderer/lib/utils'

/** A live probe of an LLM provider's saved credentials (a 1-token call). */
export function useProviderCheck(provider: LlmProvider): {
  testing: boolean
  result: ProviderTestResult | null
  check(): Promise<void>
} {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProviderTestResult | null>(null)
  const check = useCallback(async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await window.zanban.providers.testConnection(provider))
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }, [provider])
  return { testing, result, check }
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
