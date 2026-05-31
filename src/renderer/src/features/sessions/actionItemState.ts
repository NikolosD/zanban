// Stable, per-session checked-state for recap action items.
//
// The previous scheme keyed localStorage by array index (`recap-checked-<id>-<i>`)
// which desynced the moment the action-item set changed: a regenerate that
// reordered, inserted, or removed an item shifted every later checkbox onto the
// wrong row. We now key by a stable hash of the item's text so a checkbox
// follows its item across regenerations, and stale keys for deleted items are
// simply ignored (and can be garbage-collected).

export interface RecapActionItem {
  text: string
  owner: 'you' | 'them' | 'unknown'
  dueHint?: string
}

/**
 * djb2 string hash → unsigned base36. Deterministic, dependency-free, and
 * stable across processes/renderers. Collisions are astronomically unlikely for
 * the handful of action items in a single recap, and a collision would only
 * mean two items share a checkbox — not data loss.
 */
export function hashText(text: string): string {
  let h = 5381
  const normalized = text.trim()
  for (let i = 0; i < normalized.length; i++) {
    h = (h * 33) ^ normalized.charCodeAt(i)
  }
  // >>> 0 coerces to an unsigned 32-bit int so the key is always positive.
  return (h >>> 0).toString(36)
}

/** localStorage key for a single action item's checked flag, keyed by stable hash. */
export function actionItemStorageKey(sessionId: string, item: { text: string }): string {
  return `recap-checked-v2-${sessionId}-${hashText(item.text)}`
}

export function isActionItemChecked(sessionId: string, item: { text: string }): boolean {
  try {
    return localStorage.getItem(actionItemStorageKey(sessionId, item)) === '1'
  } catch {
    return false
  }
}

export function setActionItemChecked(
  sessionId: string,
  item: { text: string },
  checked: boolean
): void {
  try {
    const key = actionItemStorageKey(sessionId, item)
    if (checked) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    /* storage may be unavailable (private mode quota) — checkbox is best-effort */
  }
}
