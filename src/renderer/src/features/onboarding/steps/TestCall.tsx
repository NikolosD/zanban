import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PhoneCall } from 'lucide-react'
import type { ProviderTestResult } from '@shared/api'
import type { AppSettings } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { ProviderCheckResult, useProviderCheck } from '@renderer/features/settings/ProviderCheck'
import { llmProviderConfigured } from '@renderer/features/settings/providerStatus'
import { useTranscript } from '@renderer/features/transcript/store'
import { Probe } from './AudioCheckStep'

const TEST_LIMIT_MS = 20_000

function aiHintKey(settings: AppSettings, result: ProviderTestResult): string {
  if (settings.llmProvider === 'ollama') return 'onboarding.test.ai_hint_ollama'
  if (!llmProviderConfigured(settings) || result.reason === 'invalid_key') {
    return 'onboarding.test.ai_hint_key'
  }
  return 'onboarding.test.ai_hint_network'
}

/**
 * The two things that break a first call, tried once with the saved setup: the
 * AI answers and the microphone hears you. Optional; nothing waits on it.
 */
export function TestCall({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation()
  // A second capture on the device a live session records from can silence it.
  const sessionRunning = useTranscript((s) => s.session.kind === 'running')
  const aiCheck = useProviderCheck(settings.llmProvider)
  const [run, setRun] = useState(0)
  const [timedOut, setTimedOut] = useState(false)
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(deadline.current), [])

  function start(): void {
    clearTimeout(deadline.current)
    setTimedOut(false)
    setRun((n) => n + 1)
    void aiCheck.check()
    deadline.current = setTimeout(() => setTimedOut(true), TEST_LIMIT_MS)
  }

  // The AI probe has no timeout of its own, so a hung call is called a failure here.
  const stuck = timedOut && aiCheck.testing
  const aiTesting = aiCheck.testing && !stuck
  const aiResult: ProviderTestResult | null = stuck
    ? { ok: false, message: t('onboarding.test.ai_timeout') }
    : aiCheck.result

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
          {t('onboarding.test.title')}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={aiTesting}
          onClick={start}
        >
          <PhoneCall className="size-3.5" />
          {run === 0 ? t('onboarding.test.run') : t('onboarding.test.rerun')}
        </Button>
      </div>
      {run === 0 ? (
        <p className="text-small text-muted-foreground">{t('onboarding.test.body')}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border/60 px-3 py-2.5">
          <div className="flex flex-col gap-1">
            <div className="text-body">{t('onboarding.test.ai_label')}</div>
            <ProviderCheckResult testing={aiTesting} result={aiResult} />
            {!aiTesting && aiResult && !aiResult.ok && (
              <p className="text-small text-muted-foreground">{t(aiHintKey(settings, aiResult))}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-body">{t('onboarding.test.mic_label')}</div>
            {sessionRunning ? (
              <p className="text-small text-muted-foreground">{t('onboarding.test.mic_busy')}</p>
            ) : (
              <Probe
                key={run}
                source="mic"
                deviceId={settings.audio.micDeviceId}
                closeWhenSettled
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
