import { describe, it, expect } from 'vitest'
import { formatDuration, formatRowStamp, groupByDay, startOfDay } from './dateFormat'

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
  const dayLabels = { today: 'Today', yesterday: 'Yesterday', thisWeek: 'Earlier this week' }
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
    const groups = groupByDay(items, dayLabels, 'en')
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('Today')
    expect(labels).toContain('Yesterday')
    expect(labels).toContain('Earlier this week')
    // The fourth bucket is whatever locale formats the old date as — just
    // assert it isn't one of the known recent labels.
    const old = labels.find((l) => l !== 'Today' && l !== 'Yesterday' && l !== 'Earlier this week')
    expect(old).toBeTruthy()
  })

  it('sorts items in each bucket newest-first', () => {
    const items = [
      { startedAt: today + 9 * 3600_000 }, // morning
      { startedAt: today + 18 * 3600_000 }, // evening
      { startedAt: today + 12 * 3600_000 } // noon
    ]
    const todayGroup = groupByDay(items, dayLabels, 'en').find((g) => g.label === 'Today')
    expect(todayGroup).toBeDefined()
    const stamps = todayGroup!.items.map((i) => i.startedAt)
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a))
  })

  it('returns an empty array for empty input', () => {
    expect(groupByDay([], dayLabels, 'en')).toEqual([])
  })

  it('names older month buckets in the given UI language', () => {
    const old = [{ startedAt: new Date(2024, 9, 12, 14, 3).getTime() }]
    expect(groupByDay(old, dayLabels, 'en')[0]?.label).toBe('October 2024')
    expect(groupByDay(old, dayLabels, 'ru')[0]?.label).toMatch(/^октябрь 2024/)
  })
})

describe('formatRowStamp', () => {
  const now = new Date(2026, 9, 28, 18, 0).getTime() // Wed 2026-10-28

  it('shows only the time for today and yesterday', () => {
    expect(formatRowStamp(new Date(2026, 9, 28, 14, 3), 'ru', now)).toBe('14:03')
    expect(formatRowStamp(new Date(2026, 9, 27, 14, 3), 'ru', now)).toBe('14:03')
  })

  it('prefixes the weekday within the last week', () => {
    expect(formatRowStamp(new Date(2026, 9, 26, 14, 3), 'ru', now)).toBe('пн 14:03')
    expect(formatRowStamp(new Date(2026, 9, 26, 14, 3), 'en', now)).toMatch(/^Mon 2:03\sPM$/)
  })

  it('shows the date for older sessions', () => {
    expect(formatRowStamp(new Date(2026, 9, 12, 14, 3), 'en', now)).toBe('Oct 12')
    expect(formatRowStamp(new Date(2026, 9, 12, 14, 3), 'ru', now)).toBe('12 окт.')
  })
})
