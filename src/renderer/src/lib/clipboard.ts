import { toast } from 'sonner'
import i18n from 'i18next'

export async function copyToClipboard(text: string, label?: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label ?? i18n.t('common.copied'), { duration: 1200 })
    return true
  } catch (err) {
    toast.error(i18n.t('errors.could_not_copy'), {
      description: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}
