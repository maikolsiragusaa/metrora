import { afterEach, describe, it, expect, vi } from 'vitest'
import { formatDateRangeLabel, formatDayRangeLabel, getDateRange, parseDateRangeFlags, parseDayFlag, shiftDay } from '../src/cli-date.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('parseDateRangeFlags', () => {
  it('returns null when neither flag is provided', () => {
    expect(parseDateRangeFlags(undefined, undefined)).toBeNull()
  })

  it('parses a symmetric range in local time', () => {
    const range = parseDateRangeFlags('2026-04-07', '2026-04-10')
    expect(range).not.toBeNull()
    expect(range!.start.getFullYear()).toBe(2026)
    expect(range!.start.getMonth()).toBe(3)
    expect(range!.start.getDate()).toBe(7)
    expect(range!.start.getHours()).toBe(0)
    expect(range!.end.getDate()).toBe(10)
    expect(range!.end.getHours()).toBe(23)
    expect(range!.end.getMinutes()).toBe(59)
    expect(range!.end.getSeconds()).toBe(59)
  })

  it('accepts --from alone (open-ended to today 23:59:59)', () => {
    const range = parseDateRangeFlags('2026-04-01', undefined)
    expect(range).not.toBeNull()
    expect(range!.start.getDate()).toBe(1)
    expect(range!.end.getHours()).toBe(23)
  })

  it('accepts --to alone with the same six-calendar-month window anchored to --to', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const range = parseDateRangeFlags(undefined, '2026-04-10')

    expect(range).not.toBeNull()
    expect(range!.start.getFullYear()).toBe(2025)
    expect(range!.start.getMonth()).toBe(10) // November
    expect(range!.start.getDate()).toBe(1)
    expect(range!.start.getHours()).toBe(0)
    expect(range!.end.getFullYear()).toBe(2026)
    expect(range!.end.getMonth()).toBe(3) // April
    expect(range!.end.getDate()).toBe(10)
    expect(range!.end.getHours()).toBe(23)
  })

  it('matches the named six-month boundary when --to is today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const explicitEnd = parseDateRangeFlags(undefined, '2026-08-25')
    const named = getDateRange('all').range

    expect(explicitEnd).not.toBeNull()
    expect(explicitEnd!.start.getTime()).toBe(named.start.getTime())
    expect(explicitEnd!.end.getTime()).toBe(named.end.getTime())
  })

  it('allows a historical --to without deriving the start from the current date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const range = parseDateRangeFlags(undefined, '2024-01-15')

    expect(range).not.toBeNull()
    expect(range!.start.getFullYear()).toBe(2023)
    expect(range!.start.getMonth()).toBe(7) // August
    expect(range!.start.getDate()).toBe(1)
    expect(range!.end.getFullYear()).toBe(2024)
    expect(range!.end.getMonth()).toBe(0)
    expect(range!.end.getDate()).toBe(15)
  })

  it('throws when --from > --to', () => {
    expect(() => parseDateRangeFlags('2026-04-10', '2026-04-07'))
      .toThrow('--from must not be after --to')
  })

  it('throws on a non-ISO string', () => {
    expect(() => parseDateRangeFlags('April 7', undefined))
      .toThrow('Invalid date format')
  })

  it('throws on wrong digit count', () => {
    expect(() => parseDateRangeFlags('26-4-7', undefined))
      .toThrow('Invalid date format')
  })

  it('rejects month/day overflow instead of silently rolling forward', () => {
    expect(() => parseDateRangeFlags('2026-02-31', '2026-03-15'))
      .toThrow('Invalid date "2026-02-31"')
    expect(() => parseDateRangeFlags('2026-13-01', undefined))
      .toThrow('Invalid date "2026-13-01"')
    expect(() => parseDateRangeFlags('2026-04-31', undefined))
      .toThrow('Invalid date "2026-04-31"')
    expect(() => parseDateRangeFlags(undefined, '2026-02-30'))
      .toThrow('Invalid date "2026-02-30"')
    expect(parseDateRangeFlags('2024-02-29', '2024-03-01')).not.toBeNull()
    expect(() => parseDateRangeFlags('2025-02-29', undefined))
      .toThrow('Invalid date "2025-02-29"')
  })

  it('same day is valid (start midnight, end 23:59:59)', () => {
    const range = parseDateRangeFlags('2026-04-10', '2026-04-10')
    expect(range).not.toBeNull()
    expect(range!.start.getDate()).toBe(10)
    expect(range!.end.getDate()).toBe(10)
  })

  it('formats custom range labels consistently', () => {
    expect(formatDateRangeLabel('2026-04-07', '2026-04-10')).toBe('2026-04-07 to 2026-04-10')
    expect(formatDateRangeLabel(undefined, '2026-04-10')).toBe('all to 2026-04-10')
    expect(formatDateRangeLabel('2026-04-07', undefined)).toBe('2026-04-07 to today')
  })
})

describe('parseDayFlag', () => {
  it('returns null when no day is provided', () => {
    expect(parseDayFlag(undefined)).toBeNull()
  })

  it('parses an explicit day as local midnight through end of day', () => {
    const selected = parseDayFlag('2026-04-10')
    expect(selected).not.toBeNull()
    expect(selected!.day).toBe('2026-04-10')
    expect(selected!.label).toBe('Day (2026-04-10)')
    expect(selected!.range.start.getFullYear()).toBe(2026)
    expect(selected!.range.start.getMonth()).toBe(3)
    expect(selected!.range.start.getDate()).toBe(10)
    expect(selected!.range.start.getHours()).toBe(0)
    expect(selected!.range.end.getDate()).toBe(10)
    expect(selected!.range.end.getHours()).toBe(23)
    expect(selected!.range.end.getMinutes()).toBe(59)
    expect(selected!.range.end.getSeconds()).toBe(59)
  })

  it('resolves yesterday as the previous local calendar day after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 23, 0, 5, 0))

    const selected = parseDayFlag('yesterday')

    expect(selected!.day).toBe('2026-05-22')
    expect(selected!.range.start.getDate()).toBe(22)
    expect(selected!.range.end.getDate()).toBe(22)
  })

  it('supports today and day shifting', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 23, 12, 0, 0))

    expect(parseDayFlag('today')!.day).toBe('2026-05-23')
    expect(formatDayRangeLabel('2026-05-22')).toBe('Day (2026-05-22)')
    expect(shiftDay('2026-05-22', -1)).toBe('2026-05-21')
    expect(shiftDay('2026-05-22', 1)).toBe('2026-05-23')
  })

  it('rejects malformed or overflowing day values', () => {
    expect(() => parseDayFlag('May 22')).toThrow('Invalid date format')
    expect(() => parseDayFlag('2026-02-31')).toThrow('Invalid date "2026-02-31"')
    expect(() => shiftDay('2026-13-01', 1)).toThrow('Invalid date "2026-13-01"')
  })
})
