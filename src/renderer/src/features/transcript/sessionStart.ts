import { toast } from 'sonner'
import i18n from 'i18next'
import { startCapturesFromSettings, stopCaptures } from '@renderer/audio/captureController'
import { errorMessage, pointsToSettings } from '@renderer/lib/errors'
import { useTranscript } from './store'

/**
 * Start (or resume) a session together with audio capture. Main shows the
 * overlay and starts its timer as soon as session.start resolves, so a capture
 * failure after that point rolls the session back instead of leaving the
 * overlay "recording" nothing.
 */
export async function startSessionWithCapture(resumeId?: string): Promise<void> {
  try {
    const settings = await window.zanban.settings.get()
    await window.zanban.session.start(resumeId ? { resumeId } : undefined)
    await startCapturesFromSettings(settings)
  } catch (err) {
    stopCaptures()
    await window.zanban.session.stop().catch(() => {})
    throw err
  }
}

export function toastSessionError(title: string, err: unknown, onOpenSettings?: () => void): void {
  const description = errorMessage(err)
  toast.error(title, {
    description,
    action:
      onOpenSettings && pointsToSettings(description)
        ? { label: i18n.t('common.open_settings'), onClick: onOpenSettings }
        : undefined
  })
}

export async function resumeSession(id: string, onOpenSettings?: () => void): Promise<void> {
  if (useTranscript.getState().session.kind === 'running') {
    toast.error(i18n.t('dashboard.session_running_elsewhere'))
    return
  }
  try {
    await startSessionWithCapture(id)
  } catch (err) {
    toastSessionError(i18n.t('dashboard.could_not_resume'), err, onOpenSettings)
  }
}
