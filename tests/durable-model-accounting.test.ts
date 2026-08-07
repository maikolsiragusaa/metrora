import { describe, expect, it } from 'vitest'

import type { DailyEntry, ModelDayStats, ProviderDaySlice } from '../src/daily-cache.js'
import { aggregateDurableModelAccounting } from '../src/durable-model-accounting.js'

function model(overrides: Partial<ModelDayStats> = {}): ModelDayStats {
  return {
    calls: 1,
    cost: 1,
    savingsUSD: 0,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 1,
    ...overrides,
  }
}

function slice(models: Record<string, ModelDayStats>, overrides: Partial<ProviderDaySlice> = {}): ProviderDaySlice {
  const values = Object.values(models)
  return {
    calls: values.reduce((sum, value) => sum + value.calls, 0),
    cost: values.reduce((sum, value) => sum + value.cost, 0),
    savingsUSD: values.reduce((sum, value) => sum + value.savingsUSD, 0),
    sessions: 1,
    inputTokens: values.reduce((sum, value) => sum + value.inputTokens, 0),
    outputTokens: values.reduce((sum, value) => sum + value.outputTokens, 0),
    cacheReadTokens: values.reduce((sum, value) => sum + value.cacheReadTokens, 0),
    cacheWriteTokens: values.reduce((sum, value) => sum + value.cacheWriteTokens, 0),
    editTurns: 0,
    oneShotTurns: 0,
    models,
    categories: {},
    ...overrides,
  }
}

function day(providers: Record<string, ProviderDaySlice>, models: Record<string, ModelDayStats>): DailyEntry {
  const providerValues = Object.values(providers)
  return {
    date: '2026-08-01',
    cost: providerValues.reduce((sum, value) => sum + value.cost, 0),
    savingsUSD: providerValues.reduce((sum, value) => sum + value.savingsUSD, 0),
    calls: providerValues.reduce((sum, value) => sum + value.calls, 0),
    sessions: providerValues.reduce((sum, value) => sum + (value.sessions ?? 0), 0),
    inputTokens: providerValues.reduce((sum, value) => sum + (value.inputTokens ?? 0), 0),
    outputTokens: providerValues.reduce((sum, value) => sum + (value.outputTokens ?? 0), 0),
    cacheReadTokens: providerValues.reduce((sum, value) => sum + (value.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: providerValues.reduce((sum, value) => sum + (value.cacheWriteTokens ?? 0), 0),
    editTurns: 0,
    oneShotTurns: 0,
    models,
    categories: {},
    providers,
  }
}

describe('durable model accounting', () => {
  it('keeps the same raw model separated by provider when durable provider slices retain model detail', () => {
    const codexModel = model({ calls: 3, cost: 9 })
    const openrouterModel = model({ calls: 2, cost: 5 })
    const input = day(
      {
        codex: slice({ 'gpt-shared': codexModel }),
        openrouter: slice({ 'gpt-shared': openrouterModel }),
      },
      {
        'gpt-shared': model({ calls: 5, cost: 14, inputTokens: 20, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 2 }),
      },
    )

    const accounting = aggregateDurableModelAccounting([input])

    expect(accounting.rows).toHaveLength(2)
    expect(accounting.rows.map(row => [row.provider, row.model, row.cost])).toEqual([
      ['codex', 'gpt-shared', 9],
      ['openrouter', 'gpt-shared', 5],
    ])
    expect(accounting.gap.cost).toBe(0)
    expect(accounting.gap.calls).toBe(0)
    expect(accounting.coverage).toEqual({ cost: 1, calls: 1 })
  })

  it('falls back to the durable day model map instead of mixing incomplete provider attribution', () => {
    const complete = slice({ alpha: model({ cost: 6, calls: 2 }) })
    const legacy: ProviderDaySlice = { calls: 4, cost: 10, savingsUSD: 0 }
    const input = day(
      { codex: complete, legacy },
      {
        alpha: model({ cost: 6, calls: 2 }),
        beta: model({ cost: 10, calls: 4 }),
      },
    )
    // Older provider slices may not retain token totals; the day-level durable
    // authority still owns those totals.
    input.inputTokens = 20
    input.outputTokens = 4
    input.cacheReadTokens = 6
    input.cacheWriteTokens = 2

    const accounting = aggregateDurableModelAccounting([input])

    expect(accounting.rows.map(row => [row.provider, row.model, row.cost])).toEqual([
      [null, 'beta', 10],
      [null, 'alpha', 6],
    ])
    expect(accounting.gap.cost).toBe(0)
    expect(accounting.gap.calls).toBe(0)
  })

  it('keeps unverifiable historical spend in an explicit gap rather than assigning it to a model', () => {
    const legacy: ProviderDaySlice = { calls: 7, cost: 21, savingsUSD: 2 }
    const input = day({ codex: legacy }, {})
    input.inputTokens = 70
    input.outputTokens = 14
    input.cacheReadTokens = 21
    input.cacheWriteTokens = 7

    const accounting = aggregateDurableModelAccounting([input])

    expect(accounting.rows).toEqual([])
    expect(accounting.gap).toEqual({
      cost: 21,
      savingsUSD: 2,
      calls: 7,
      inputTokens: 70,
      outputTokens: 14,
      cacheReadTokens: 21,
      cacheWriteTokens: 7,
    })
    expect(accounting.coverage).toEqual({ cost: 0, calls: 0 })
  })

  it('aggregates exactly the supplied durable day range', () => {
    const first = day({ codex: slice({ alpha: model({ cost: 4, calls: 2 }) }) }, { alpha: model({ cost: 4, calls: 2 }) })
    const second = day({ codex: slice({ alpha: model({ cost: 7, calls: 3 }) }) }, { alpha: model({ cost: 7, calls: 3 }) })
    second.date = '2026-08-02'

    expect(aggregateDurableModelAccounting([first]).total.cost).toBe(4)
    expect(aggregateDurableModelAccounting([second]).total.cost).toBe(7)
    expect(aggregateDurableModelAccounting([first, second]).rows[0]).toMatchObject({ provider: 'codex', model: 'alpha', cost: 11, calls: 5 })
  })
})
