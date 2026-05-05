import { describe, it, expect } from 'vitest'
import { formatDuration, groupByDay, startOfDay } from './dateFormat'

describe('formatDuration', () => {
  it('returns null for nullish or sub-second durations', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(500)).toBeNull()
  })

  it('formats sub-minute durations with leading zeros', () => {
    expect(formatDuration(1_000)).toBe('00:01')
    expect(formatDuration(45_000)).toBe('00:45')
    expect(formatDuration(59_999)).toBe('01:00') // round up to 60s
  })

  it('formats minute-scale durations as MM:SS', () => {
    expect(formatDuration(60_000)).toBe('01:00')
    expect(formatDuration(125_000)).toBe('02:05')
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59:59')
  })

  it('formats hour-scale durations as H:MM:SS', () => {
    expect(formatDuration(60 * 60_000)).toBe('1:00:00')
    expect(formatDuration(2 * 60 * 60_000 + 5 * 60_000 + 7_000)).toBe('2:05:07')
  })
})

describe('startOfDay', () => {
  it('zeros out hours/minutes/seconds/ms', () => {
    const d = new Date(2024, 5, 15, 14, 32, 18, 500) // 2024-06-15 14:32:18.500
    const t = startOfDay(d)
    const back = new Date(t)
    expect(back.getHours()).toBe(0)
    expect(back.getMinutes()).toBe(0)
    expect(back.getSeconds()).toBe(0)
    expect(back.getMilliseconds()).toBe(0)
    expect(back.getDate()).toBe(15)
  })
})

describe('groupByDay', () => {
  // Use real dates relative to now so the Today/Yesterday/Earlier-this-week
  // bucketing is exercised regardless of when tests run.
  const now = Date.now()
  const today = startOfDay(new Date(now))

  it('buckets items into Today / Yesterday / Earlier this week / month-year', () => {
    const items = [
      { startedAt: today + 12 * 3600_000 }, // today @noon
      { startedAt: today - 1 * 86_400_000 + 9 * 3600_000 }, // yesterday
      { startedAt: today - 3 * 86_400_000 }, // 3 days ago — earlier this week
      { startedAt: today - 90 * 86_400_000 } // ~3 months ago — month-year bucket
    ]
    const groups = groupByDay(items)
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('Today')
    expect(labels).toContain('Yesterday')
    expect(labels).toContain('Earlier this week')
    // The fourth bucket is whatever locale formats the old date as — just
    // assert it isn't one of the known recent labels.
    const old = labels.find(
      (l) => l !== 'Today' && l !== 'Yesterday' && l !== 'Earlier this week'
    )
    expect(old).toBeTruthy()
  })

  it('sorts items in each bucket newest-first', () => {
    const items = [
      { startedAt: today + 9 * 3600_000 }, // morning
      { startedAt: today + 18 * 3600_000 }, // evening
      { startedAt: today + 12 * 3600_000 } // noon
    ]
    const todayGroup = groupByDay(items).find((g) => g.label === 'Today')
    expect(todayGroup).toBeDefined()
    const stamps = todayGroup!.items.map((i) => i.startedAt)
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a))
  })

  it('returns an empty array for empty input', () => {
    expect(groupByDay([])).toEqual([])
  })
})
