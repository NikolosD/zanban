// Ctrl+Alt is AltGr on many layouts, so it only pairs with keys none of them type with (R, J).
// None of these is a default hotkey, and none is a call staple like Ctrl+Shift+A or Ctrl+Shift+D.
const CANDIDATES = [
  'Control+Shift+4',
  'Control+Shift+5',
  'Control+Shift+6',
  'Control+Shift+7',
  'Control+Shift+8',
  'Control+Shift+9',
  'Control+Alt+Shift+R',
  'Control+Alt+Shift+J'
]

export function alternativeAccelerators(taken: Iterable<string>): string[] {
  const inUse = new Set(Array.from(taken, (accelerator) => accelerator.toLowerCase()))
  return CANDIDATES.filter((accelerator) => !inUse.has(accelerator.toLowerCase()))
}
