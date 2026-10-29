import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PROVIDER_MODEL_DEFAULTS } from '@shared/types'
import type { OllamaHealth } from '@shared/api'
import { Button } from '@renderer/components/ui/button'
import { OllamaPullStatus, useOllamaPull } from '@renderer/features/settings/OllamaPull'

// One model covers every role, so it is the only download the setup needs.
const MODEL = PROVIDER_MODEL_DEFAULTS.ollama.fast

/**
 * Local answers need Ollama running with a model in it; without them the
 * first question fails. Checks both and offers to download the model here.
 */
export function OllamaSetup({ host }: { host: string | null }) {
  const { t } = useTranslation()
  const [health, setHealth] = useState<OllamaHealth | null>(null)
  const [checks, setChecks] = useState(0)
  const recheck = () => setChecks((n) => n + 1)
  const ollamaPull = useOllamaPull(recheck)

  useEffect(() => {
    let alive = true
    void window.zanban.ollama.health().then((h) => {
      if (alive) setHealth(h)
    })
    return () => {
      alive = false
    }
  }, [host, checks])

  if (!health) {
    return (
      <span className="flex items-center gap-1 text-small text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {t('onboarding.keys.ollama_setup.checking')}
      </span>
    )
  }

  if (!health.running) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
        <span className="flex items-start gap-1.5 text-small text-warn">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {t('onboarding.keys.ollama_setup.not_running')}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void window.zanban.openExternal('https://ollama.com/download')}
          >
            <ExternalLink className="size-3" />
            {t('onboarding.keys.ollama_setup.get_ollama')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={recheck}>
            <RefreshCw className="size-3" />
            {t('onboarding.keys.ollama_setup.recheck')}
          </Button>
        </div>
      </div>
    )
  }

  if (health.models.includes(MODEL)) {
    return (
      <span className="flex items-center gap-1 text-small text-success">
        <CheckCircle2 className="size-3 shrink-0" />
        {t('onboarding.keys.ollama_setup.ready', { name: MODEL })}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <span className="text-small leading-relaxed text-muted-foreground">
        {t('onboarding.keys.ollama_setup.needs_model', { name: MODEL })}
      </span>
      {ollamaPull.pulling ? (
        <span className="text-small text-muted-foreground">
          {t('onboarding.keys.ollama_setup.keep_going')}
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          className="gap-1.5 self-start"
          onClick={() => void ollamaPull.pull(MODEL)}
        >
          <Download className="size-3" />
          {t('settings.providers.ollama_pull_title', { name: MODEL })}
        </Button>
      )}
      <OllamaPullStatus {...ollamaPull} />
    </div>
  )
}
