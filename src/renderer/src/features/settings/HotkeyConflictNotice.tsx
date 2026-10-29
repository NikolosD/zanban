import { useId, useState } from 'react'
import { Keyboard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import type { HotkeyConflict } from '@shared/api'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { errorMessage } from '@renderer/lib/errors'
import { acceleratorTokens, prettyAccelerator } from './KeyRecorder'

const TOAST_ID = 'hotkey-conflicts'

export function HotkeyConflictNotice({
  conflicts,
  onPickFree,
  onChange
}: {
  conflicts: HotkeyConflict[]
  onPickFree(): Promise<void>
  onChange(): void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const [picking, setPicking] = useState(false)

  async function pickFree(): Promise<void> {
    setPicking(true)
    try {
      await onPickFree()
    } finally {
      setPicking(false)
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex w-full flex-col gap-3 rounded-lg border border-warn/30 bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-2.5">
        <Keyboard className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <p id={titleId} className="text-body font-medium">
            {t('settings.hotkeys_section.conflict_title', { count: conflicts.length })}
          </p>
          <p className="mt-0.5 text-small text-muted-foreground">
            {t('settings.hotkeys_section.conflict_hint')}
          </p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/60">
        {conflicts.map(({ action, accelerator }) => (
          <li key={action} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="text-small text-foreground/90">
              {t(`settings.hotkey.${action}.label`)}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {acceleratorTokens(accelerator).map((part, i) => (
                <Kbd key={i} size="md">
                  {part}
                </Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onChange}>
          {t('settings.hotkeys_section.conflict_change')}
        </Button>
        <Button size="sm" disabled={picking} onClick={() => void pickFree()}>
          {picking && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t('settings.hotkeys_section.conflict_pick_free')}
        </Button>
      </div>
    </div>
  )
}

async function pickFreeHotkeys(): Promise<void> {
  const label = (action: HotkeyConflict['action']): string =>
    i18n.t(`settings.hotkey.${action}.label`)
  try {
    const { assigned, unresolved } = await window.zanban.settings.pickFreeHotkeys()
    if (assigned.length > 0) {
      toast.success(
        i18n.t('settings.hotkeys_section.conflict_picked', { count: assigned.length }),
        {
          description: assigned.map(({ action, accelerator }) => (
            <div key={action}>
              {label(action)}: {prettyAccelerator(accelerator)}
            </div>
          ))
        }
      )
    }
    if (unresolved.length > 0) {
      toast.warning(
        i18n.t('settings.hotkeys_section.conflict_unresolved', {
          actions: unresolved.map(({ action }) => label(action)).join(', ')
        })
      )
    }
  } catch (err) {
    toast.error(i18n.t('settings.hotkeys_section.conflict_pick_failed'), {
      description: errorMessage(err)
    })
  }
}

export function showHotkeyConflicts(failed: HotkeyConflict[], onChange: () => void): void {
  if (failed.length === 0) {
    toast.dismiss(TOAST_ID)
    return
  }
  toast.custom(
    () => (
      <HotkeyConflictNotice conflicts={failed} onPickFree={pickFreeHotkeys} onChange={onChange} />
    ),
    { id: TOAST_ID, duration: Infinity }
  )
}
