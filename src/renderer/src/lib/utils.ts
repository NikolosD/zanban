import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The theme's own font sizes (--text-* in styles/tailwind.css). Stock
// tailwind-merge reads them as colors, so `text-meta text-success` dropped the size.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['meta', 'small', 'body', 'lead', 'display'] } }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
