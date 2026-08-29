import { describe, expect, it } from 'vitest'
import { mergeDayEntriesByProviderCompleteness } from '../src/daily-cache-merge.js'
import type { DailyEntry, ProviderDaySlice } from '../src/daily-cache-types.js'

function slice(cost: number, calls = cost, sessions = 1): ProviderDaySlice {
  return {
    cost,
    calls,
    savingsUSD: 0,
    sessions,
    inputTokens: calls * 10,
    outputTokens: calls * 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    models: {},
    categories: {},
    projects: {},
  }
}

function day(date: string, providers: Record<string, ProviderDaySlice>): DailyEntry {
  const values = Object.values(providers)
  return {
    date,
    cost: values.reduce((sum, value) => sum + value.cost, 0),
    savingsUSD: values.reduce((sum, value) => sum + value.savingsUSD, 0),
    calls: values.reduce((sum, value) => sum + value.calls, 0),
    sessions: values.reduce((sum, value) => sum + (value.sessions ?? 0), 0),
    inputTokens: values.reduce((sum, value) => sum + (value.inputTokens ?? 0), 0),
    outputTokens: values.reduce((sum, value) => sum + (value.outputTokens ?? 0), 0),
    cacheReadTokens: values.reduce((sum, value) => sum + (value.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: values.reduce((sum, value) => sum + (value.cacheWriteTokens ?? 0), 0),
    editTurns: 0,
    oneShotTurns: 0,
    models: {},
    categories: {},
    providers,
  }
}

describe('degraded daily cache provider reconciliation', () => {
  it('advances a complete provider while retaining an incomplete provider baseline', () => {
    const baseline = day('2026-08-27', {
      codex: slice(10, 10),
      broken: slice(5, 5),
    })
    const fresh = day('2026-08-27', {
      codex: slice(14, 14),
      broken: slice(1, 1),
    })

    const [merged] = mergeDayEntriesByProviderCompleteness(
      [fresh],
      [baseline],
      provider => provider === 'codex' ? true : provider === 'broken' ? false : undefined,
    )

    expect(merged.providers.codex?.cost).toBe(14)
    expect(merged.providers.broken?.cost).toBe(5)
    expect(merged.cost).toBe(19)
    expect(merged.calls).toBe(19)
    expect(merged.carried).toBe(true)
  })

  it('keeps newly observed evidence when an incomplete provider has no finalized baseline', () => {
    const fresh = day('2026-08-28', { codex: slice(3, 3) })
    const [merged] = mergeDayEntriesByProviderCompleteness([fresh], [], () => false)

    expect(merged.providers.codex?.cost).toBe(3)
    expect(merged.cost).toBe(3)
    expect(merged.carried).toBeUndefined()
  })

  it('does not let partial fresh evidence replace an existing incomplete provider slice', () => {
    const baseline = day('2026-08-27', { codex: slice(10, 10) })
    const fresh = day('2026-08-27', { codex: slice(4, 4) })
    const [merged] = mergeDayEntriesByProviderCompleteness([fresh], [baseline], () => false)

    expect(merged.providers.codex?.cost).toBe(10)
    expect(merged.cost).toBe(10)
    expect(merged.carried).toBe(true)
  })

  it('keeps an opaque legacy baseline authoritative because it cannot be split safely', () => {
    const baseline: DailyEntry = {
      ...day('2026-08-27', {}),
      cost: 9,
      calls: 9,
    }
    const fresh = day('2026-08-27', { codex: slice(12, 12) })
    const [merged] = mergeDayEntriesByProviderCompleteness([fresh], [baseline], () => true)

    expect(merged.cost).toBe(9)
    expect(merged.calls).toBe(9)
    expect(merged.providers).toEqual({})
    expect(merged.carried).toBe(true)
  })
})
