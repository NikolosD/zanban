import { toast } from 'sonner'

export async function copyToClipboard(text: string, label = 'Copied'): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label, { duration: 1200 })
    return true
  } catch (err) {
    toast.error('Could not copy', {
      description: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}
