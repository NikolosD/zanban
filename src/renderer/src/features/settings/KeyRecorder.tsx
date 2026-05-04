import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export function KeyRecorder({
  value,
  defaultValue,
  onChange,
  className
}: {
  value: string
  defaultValue?: string
  onChange(next: string): void
  className?: string
}) {
  const [recording, setRecording] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recording) return
    function onKeyDown(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()

      if (e.code === 'Escape') {
        setRecording(false)
        return
      }
      if (e.code === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        onChange('')
        setRecording(false)
        return
      }

      const main = mapKeyCode(e.code, e.key)
      if (!main) return // modifier-only — keep waiting

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Control')
      if (e.metaKey) parts.push(IS_MAC ? 'Cmd' : 'Super')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      parts.push(main)

      // Require at least one modifier for letter/digit keys to avoid a bare 'A' shortcut
      const isAlnum = /^[A-Z0-9]$/.test(main)
      if (isAlnum && parts.length === 1) return // wait for modifier

      onChange(parts.join('+'))
      setRecording(false)
    }
    function onBlur(): void {
      setRecording(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording, onChange])

  const segments = value ? parseAccelerator(value) : []
  const isDefault = !defaultValue || value === defaultValue

  return (
    <div ref={rootRef} className={cn('flex items-center gap-1.5', className)}>
      <button
        type="button"
        onClick={() => setRecording((r) => !r)}
        className={cn(
          'inline-flex min-h-[32px] flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1 text-left transition-colors',
          recording
            ? 'border-primary/60 bg-primary/10 text-foreground'
            : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
        )}
      >
        {recording ? (
          <span className="flex items-center gap-2 font-mono text-[11px] text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            press keys… (Esc cancel · ⌫ clear)
          </span>
        ) : segments.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {segments.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/40">+</span>}
                <Kbd>{s}</Kbd>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">click to record…</span>
        )}
      </button>
      {!isDefault && defaultValue && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          title={`Reset to ${prettyAccelerator(defaultValue)}`}
          onClick={() => onChange(defaultValue)}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          title="Clear binding"
          onClick={() => onChange('')}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/15 bg-white/10 px-1.5 font-mono text-[10px] leading-none text-foreground">
      {children}
    </kbd>
  )
}

export function prettyAccelerator(acc: string): string {
  return parseAccelerator(acc).join(' + ')
}

function parseAccelerator(acc: string): string[] {
  return acc
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(prettyToken)
}

function prettyToken(token: string): string {
  switch (token) {
    case 'Control':
    case 'Ctrl':
      return IS_MAC ? '⌃' : 'Ctrl'
    case 'Cmd':
    case 'Command':
      return '⌘'
    case 'CommandOrControl':
    case 'CmdOrCtrl':
      return IS_MAC ? '⌘' : 'Ctrl'
    case 'Alt':
    case 'Option':
      return IS_MAC ? '⌥' : 'Alt'
    case 'Shift':
      return IS_MAC ? '⇧' : 'Shift'
    case 'Super':
    case 'Meta':
      return IS_MAC ? '⌘' : 'Win'
    case 'Return':
    case 'Enter':
      return '↵'
    case 'Backspace':
      return '⌫'
    case 'Delete':
      return '⌦'
    case 'Tab':
      return 'Tab'
    case 'Space':
      return 'Space'
    case 'Escape':
    case 'Esc':
      return 'Esc'
    case 'Up':
      return '↑'
    case 'Down':
      return '↓'
    case 'Left':
      return '←'
    case 'Right':
      return '→'
    default:
      return token
  }
}

function mapKeyCode(code: string, key: string): string | null {
  // Letter keys: KeyA..KeyZ
  const letter = code.match(/^Key([A-Z])$/)
  if (letter && letter[1]) return letter[1]
  // Digits (top row + numpad)
  const digit = code.match(/^Digit(\d)$/) || code.match(/^Numpad(\d)$/)
  if (digit && digit[1]) return digit[1]
  // Function keys
  if (/^F(\d{1,2})$/.test(code)) return code
  switch (code) {
    case 'Enter':
    case 'NumpadEnter':
      return 'Return'
    case 'Space':
      return 'Space'
    case 'Tab':
      return 'Tab'
    case 'Backspace':
      return 'Backspace'
    case 'Delete':
      return 'Delete'
    case 'Insert':
      return 'Insert'
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
      return code
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'Backslash':
      return '\\'
    case 'Slash':
      return '/'
    case 'Backquote':
      return '`'
    case 'Minus':
      return '-'
    case 'Equal':
      return '='
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Semicolon':
      return ';'
    case 'Quote':
      return "'"
    case 'Comma':
      return ','
    case 'Period':
      return '.'
    case 'NumpadAdd':
      return 'numadd'
    case 'NumpadSubtract':
      return 'numsub'
    case 'NumpadMultiply':
      return 'nummult'
    case 'NumpadDivide':
      return 'numdiv'
    case 'NumpadDecimal':
      return 'numdec'
  }
  // Modifier-only — return null so we keep waiting
  if (
    code === 'ControlLeft' ||
    code === 'ControlRight' ||
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'AltLeft' ||
    code === 'AltRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight' ||
    code === 'OSLeft' ||
    code === 'OSRight'
  ) {
    return null
  }
  // Fallback: use the printable key if available
  if (key && key.length === 1) return key.toUpperCase()
  return null
}
