import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  getDateRange,
  PERIODS,
  PERIOD_LABELS,
  parsePeriodOrThrow,
  periodInfoFromQuery,
  toPeriod,
  type Period,
} from '../src/cli-date.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('getDateRange', () => {
  it('"all" spans six calendar months including the current month, not epoch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const { range, label } = getDateRange('all')

    expect(label).toBe('Last 6 months')
    expect(range.start.getFullYear()).toBe(2026)
    expect(range.start.getMonth()).toBe(2) // March
    expect(range.start.getDate()).toBe(1)
    expect(range.start.getHours()).toBe(0)
    expect(range.end.getFullYear()).toBe(2026)
    expect(range.end.getMonth()).toBe(7) // August
    expect(range.end.getDate()).toBe(25)
    expect(range.end.getHours()).toBe(23)
    expect(range.end.getMinutes()).toBe(59)
  })

  it('"all" does not overflow past the target month at end-of-month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0))

    const { range } = getDateRange('all')

    expect(range.start.getFullYear()).toBe(2026)
    expect(range.start.getMonth()).toBe(2) // March
    expect(range.start.getDate()).toBe(1)
  })

  it('"lifetime" starts at local epoch and stays open-ended through today', () => {
    const { range, label } = getDateRange('lifetime')

    expect(label).toBe('Lifetime')
    expect(range.start.getFullYear()).toBe(1970)
    expect(range.start.getMonth()).toBe(0)
    expect(range.start.getDate()).toBe(1)
    expect(range.end.getHours()).toBe(23)
    expect(range.end.getMinutes()).toBe(59)
  })

  it('"week" contains exactly seven inclusive local calendar dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const { range, label } = getDateRange('week')

    expect(label).toBe('Last 7 Days')
    expect(range.start.getFullYear()).toBe(2026)
    expect(range.start.getMonth()).toBe(7)
    expect(range.start.getDate()).toBe(19)
    expect(range.start.getHours()).toBe(0)
    expect(range.end.getDate()).toBe(25)
    expect(range.end.getHours()).toBe(23)
  })

  it('"month" starts on day 1 of the current month', () => {
    const { range } = getDateRange('month')
    expect(range.start.getDate()).toBe(1)
    expect(range.start.getHours()).toBe(0)
  })

  it('"30days" contains exactly thirty inclusive local calendar dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 12, 0, 0))

    const { range, label } = getDateRange('30days')

    expect(label).toBe('Last 30 Days')
    expect(range.start.getFullYear()).toBe(2026)
    expect(range.start.getMonth()).toBe(6) // July
    expect(range.start.getDate()).toBe(27)
    expect(range.start.getHours()).toBe(0)
    expect(range.end.getFullYear()).toBe(2026)
    expect(range.end.getMonth()).toBe(7)
    expect(range.end.getDate()).toBe(25)
    expect(range.end.getHours()).toBe(23)
  })

  it('"today" starts at local midnight', () => {
    const { range } = getDateRange('today')
    expect(range.start.getHours()).toBe(0)
    expect(range.start.getMinutes()).toBe(0)
    expect(range.end.getHours()).toBe(23)
  })

  it('"yesterday" is supported (CLI-only convenience)', () => {
    const { range, label } = getDateRange('yesterday')
    expect(label).toMatch(/^Yesterday/)
    expect(range.start.getHours()).toBe(0)
    expect(range.end.getHours()).toBe(23)
  })

  it('unknown period exits with an error instead of silently falling back', () => {
    expect(() => getDateRange('not-a-period')).toThrow()
  })
})

describe('PERIODS / PERIOD_LABELS', () => {
  it('exposes the expected period set', () => {
    expect(PERIODS).toEqual(['today', 'week', '30days', 'month', 'all', 'lifetime'])
  })

  it('has a label for every period', () => {
    for (const p of PERIODS) {
      expect(PERIOD_LABELS[p]).toBeTruthy()
    }
  })

  it('"all" tab label reflects the 6-month bound', () => {
    expect(PERIOD_LABELS.all).toBe('6 Months')
  })

  it('"lifetime" tab label is explicit about the unbounded range', () => {
    expect(PERIOD_LABELS.lifetime).toBe('Lifetime')
  })
})

describe('parsePeriodOrThrow', () => {
  it('round-trips known periods', () => {
    const known: Period[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
    for (const p of known) {
      expect(parsePeriodOrThrow(p)).toBe(p)
    }
  })

  it('throws on unknown input without calling process.exit', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    try {
      expect(() => parsePeriodOrThrow('garbage')).toThrow(/Unknown period "garbage"/)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
    }
  })
})

describe('periodInfoFromQuery', () => {
  it('resolves a named period', () => {
    const info = periodInfoFromQuery({ period: 'week' }, 'month')
    expect(info.label).toBe('Last 7 Days')
  })

  it('throws for an invalid period without calling process.exit', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    try {
      expect(() => periodInfoFromQuery({ period: 'garbage' }, 'month')).toThrow(/Unknown period "garbage"/)
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
    }
  })
})

describe('toPeriod', () => {
  it('round-trips known periods', () => {
    const known: Period[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
    for (const p of known) {
      expect(toPeriod(p)).toBe(p)
    }
  })

  it('exits with an error on unknown input instead of silently falling back', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') }) as unknown as ReturnType<typeof vi.spyOn>
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(() => toPeriod('garbage')).toThrow('exit')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(stderrSpy).toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  })
})
